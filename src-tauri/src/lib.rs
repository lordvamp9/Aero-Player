use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;

mod discord;

// =====================================================================
// OAuth: servidor de callback de un solo uso (reemplaza al http de Node)
// =====================================================================
#[tauri::command]
fn oauth_listen(port: u16, path: String, provider: String) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(180);
    let body = success_html(&provider);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );

    loop {
        if Instant::now() > deadline {
            return Err("Tiempo de espera agotado para la autorizacion.".into());
        }
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first = req.lines().next().unwrap_or("");
                let target = first.split_whitespace().nth(1).unwrap_or("");

                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(qpos) = target.find('?') {
                    let (p, query) = target.split_at(qpos);
                    if path.is_empty() || p == path {
                        return Ok(query[1..].to_string());
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn success_html(provider: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Aero Player</title>\
<style>body{{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;\
background:#06122b;color:#cfe4ff;font-family:'Segoe UI',sans-serif;font-weight:300}}\
.card{{padding:40px 56px;border-radius:12px;background:linear-gradient(180deg,rgba(20,55,150,.3),rgba(5,18,70,.45));\
border:1px solid rgba(120,180,255,.25);box-shadow:0 8px 40px rgba(0,20,100,.5);text-align:center}}\
h1{{font-weight:300;font-size:22px;margin:0 0 8px}}p{{opacity:.8;margin:0}}</style></head>\
<body><div class=\"card\"><h1>Conexion con {} completada</h1>\
<p>Ya puedes volver a Aero Player. Esta ventana se puede cerrar.</p></div></body></html>",
        provider
    )
}

// =====================================================================
// Biblioteca local: escaneo recursivo (walkdir) + metadata (lofty)
// =====================================================================
const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];
const VIDEO_EXT: &[&str] = &["mp4", "webm", "mkv", "mov"];

fn should_skip(entry: &walkdir::DirEntry) -> bool {
    if entry.file_type().is_dir() {
        let name = entry.file_name().to_string_lossy();
        let skip = ["node_modules", "$RECYCLE.BIN", "System Volume Information", ".git"];
        return skip.contains(&name.as_ref()) || name.starts_with('.');
    }
    false
}

#[tauri::command]
fn scan_folder(folder: String) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let walker = walkdir::WalkDir::new(&folder)
        .max_depth(12)
        .into_iter()
        .filter_entry(|e| !should_skip(e));
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let is_audio = AUDIO_EXT.contains(&ext.as_str());
        let is_video = VIDEO_EXT.contains(&ext.as_str());
        if !is_audio && !is_video {
            continue;
        }
        out.push(serde_json::json!({
            "filePath": p.to_string_lossy(),
            "fileName": entry.file_name().to_string_lossy(),
            "ext": format!(".{}", ext),
            "kind": if is_video { "video" } else { "audio" },
        }));
    }
    out
}

fn fmt_duration(seconds: f64) -> String {
    if !seconds.is_finite() || seconds <= 0.0 {
        return "0:00".into();
    }
    let total = seconds.round() as u64;
    format!("{}:{:02}", total / 60, total % 60)
}

#[tauri::command]
fn read_metadata(path: String) -> serde_json::Value {
    let pb = std::path::Path::new(&path);
    let file_name = pb
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let ext = pb
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_uppercase();

    match lofty::read_from_path(&path) {
        Ok(tagged) => {
            let props = tagged.properties();
            let dur = props.duration().as_secs_f64();
            let bitrate = props.audio_bitrate();
            let sample_rate = props.sample_rate();
            let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

            let (title, artist, album, genre, year, track_no, cover) = if let Some(t) = tag {
                let cover = t.pictures().first().map(|p| {
                    let mime = p.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
                    let b64 = base64::engine::general_purpose::STANDARD.encode(p.data());
                    format!("data:{};base64,{}", mime, b64)
                });
                (
                    t.title().map(|s| s.to_string()),
                    t.artist().map(|s| s.to_string()),
                    t.album().map(|s| s.to_string()),
                    t.genre().map(|s| s.to_string()),
                    t.year(),
                    t.track(),
                    cover,
                )
            } else {
                (None, None, None, None, None, None, None)
            };

            serde_json::json!({
                "title": title.unwrap_or(file_name),
                "artist": artist.unwrap_or_else(|| "Artista desconocido".into()),
                "album": album.unwrap_or_else(|| "Album desconocido".into()),
                "genre": genre.unwrap_or_else(|| "Sin genero".into()),
                "year": year,
                "trackNo": track_no,
                "duration": dur,
                "durationFormatted": fmt_duration(dur),
                "bitrate": bitrate,
                "codec": ext,
                "sampleRate": sample_rate,
                "coverUrl": cover,
            })
        }
        Err(_) => serde_json::json!({
            "title": file_name,
            "artist": "Artista desconocido",
            "album": "Album desconocido",
            "genre": "Sin genero",
            "year": null,
            "trackNo": null,
            "duration": 0.0,
            "durationFormatted": "0:00",
            "bitrate": null,
            "codec": ext,
            "sampleRate": null,
            "coverUrl": null,
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            oauth_listen,
            scan_folder,
            read_metadata,
            discord::discord_init,
            discord::discord_update,
            discord::discord_clear,
            discord::discord_disconnect
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
