// =====================================================================
// AERO PLAYER  ·  discord.rs
// Integracion con Discord Rich Presence sobre IPC local.
// El cliente RPC se mantiene vivo en un Mutex global y se reconecta
// silenciosamente si Discord se cierra/abre durante la sesion.
// =====================================================================
use discord_rich_presence::{
    activity::{Activity, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CLIENT: Lazy<Mutex<Option<DiscordIpcClient>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn discord_init(client_id: String) -> Result<(), String> {
    let mut slot = CLIENT.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let mut client = DiscordIpcClient::new(&client_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    *slot = Some(client);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPresence {
    pub title: String,
    pub artist: String,
    pub source: String,
    pub is_playing: bool,
    pub duration: Option<u64>,
    pub elapsed: Option<u64>,
    pub spotify_id: Option<String>,
    pub video_id: Option<String>,
}

#[tauri::command]
pub fn discord_update(payload: TrackPresence) -> Result<(), String> {
    let mut slot = CLIENT.lock().map_err(|e| e.to_string())?;
    let Some(client) = slot.as_mut() else {
        return Err("Discord no conectado".into());
    };

    // --- Assets ---
    // Large = aero (konata) siempre, para mantener identidad de marca.
    // Small = local (disco) siempre por ahora, como prueba estetica.
    // El estado play/pausa se refleja en el texto al hover del icono chico.
    let small_text = if payload.is_playing {
        "Reproduciendo"
    } else {
        "En pausa"
    };
    let large_text = match payload.source.as_str() {
        "spotify" => "Aero Player · Spotify",
        "youtube" => "Aero Player · YouTube",
        "local" => "Aero Player · Biblioteca local",
        _ => "Aero Player",
    };

    let assets = Assets::new()
        .large_image("aero")
        .large_text(large_text)
        .small_image("local")
        .small_text(small_text);

    // --- Timestamps: solo mientras esta reproduciendo y conocemos la duracion ---
    // Discord usa start+end para mostrar "tiempo restante" con el hourglass.
    let timestamps_opt = if payload.is_playing {
        if let Some(dur) = payload.duration {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0) as i64;
            let elapsed = payload.elapsed.unwrap_or(0) as i64;
            let start = now - elapsed;
            let end = start + dur as i64;
            Some(Timestamps::new().start(start).end(end))
        } else {
            None
        }
    } else {
        None
    };

    // --- Botones (max 2) ---
    let spotify_url;
    let youtube_url;
    let mut buttons: Vec<Button> = Vec::new();
    match payload.source.as_str() {
        "spotify" => {
            if let Some(id) = payload.spotify_id.as_deref() {
                spotify_url = format!("https://open.spotify.com/track/{}", id);
                buttons.push(Button::new("Abrir en Spotify", &spotify_url));
            }
        }
        "youtube" => {
            if let Some(id) = payload.video_id.as_deref() {
                youtube_url = format!("https://www.youtube.com/watch?v={}", id);
                buttons.push(Button::new("Ver en YouTube", &youtube_url));
            }
        }
        _ => {}
    }

    // --- Construir actividad final ---
    let mut activity = Activity::new()
        .details(&payload.title)
        .state(&payload.artist)
        .assets(assets);

    if let Some(ts) = timestamps_opt.as_ref() {
        activity = activity.timestamps(ts.clone());
    }
    if !buttons.is_empty() {
        activity = activity.buttons(buttons);
    }

    client.set_activity(activity).map_err(|e| {
        log::warn!("[discord] set_activity fallo: {}", e);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn discord_clear() -> Result<(), String> {
    let mut slot = CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(client) = slot.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

#[tauri::command]
pub fn discord_disconnect() -> Result<(), String> {
    let mut slot = CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(mut client) = slot.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
    Ok(())
}
