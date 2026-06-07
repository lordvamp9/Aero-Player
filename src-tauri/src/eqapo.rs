// =====================================================================
// AERO PLAYER  ·  eqapo.rs
// Integracion con Equalizer APO (Windows). Escribe el archivo de
// configuracion que EqAPO observa para aplicar EQ a todo el audio del
// sistema. El servicio detecta los cambios al instante (file watcher
// interno), no hace falta reiniciar nada.
//
// Estado:
//   - eqapo_status()  -> { installed, path }
//   - eqapo_apply()   -> escribe bandas (modo activo)
//   - eqapo_clear()   -> deja el archivo plano (modo bypass)
// =====================================================================
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct EqBand {
    pub freq: f32,
    pub gain: f32,
}

#[derive(Debug, Serialize)]
pub struct EqApoStatus {
    pub installed: bool,
    pub path: Option<String>,
}

fn candidate_paths() -> Vec<PathBuf> {
    vec![
        PathBuf::from("C:\\Program Files\\EqualizerAPO\\config\\config.txt"),
        PathBuf::from("C:\\Program Files (x86)\\EqualizerAPO\\config\\config.txt"),
    ]
}

fn config_path() -> Option<PathBuf> {
    candidate_paths().into_iter().find(|p| p.parent().map(|d| d.exists()).unwrap_or(false))
}

#[tauri::command]
pub fn eqapo_status() -> EqApoStatus {
    if let Some(p) = config_path() {
        EqApoStatus {
            installed: true,
            path: Some(p.to_string_lossy().to_string()),
        }
    } else {
        EqApoStatus { installed: false, path: None }
    }
}

#[tauri::command]
pub fn eqapo_apply(bands: Vec<EqBand>, preamp: f32) -> Result<(), String> {
    let path = config_path().ok_or("Equalizer APO no detectado.")?;
    let mut s = String::new();
    s.push_str("# Aero Player EQ - configuracion automatica\n");
    s.push_str("# Este archivo se reescribe cada vez que Aero Player ajusta el ecualizador.\n");
    s.push_str("# Cuando Aero se cierra o se desactiva el EQ, queda en bypass (Preamp 0 dB).\n");
    s.push_str(&format!("Preamp: {:.1} dB\n", preamp));
    for (i, b) in bands.iter().enumerate() {
        let typ = if i == 0 {
            "LSC" // low shelf en la primera banda (graves)
        } else if i == bands.len() - 1 {
            "HSC" // high shelf en la ultima banda (agudos)
        } else {
            "PK" // peaking en las del medio
        };
        s.push_str(&format!(
            "Filter {:>2}: ON {} Fc {} Hz Gain {:.2} dB Q 1.0\n",
            i + 1,
            typ,
            b.freq as u32,
            b.gain
        ));
    }
    fs::write(&path, s).map_err(|e| format!("No se pudo escribir el config de EqAPO: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn eqapo_clear() -> Result<(), String> {
    let path = config_path().ok_or("Equalizer APO no detectado.")?;
    let s = "# Aero Player EQ desactivado (bypass)\nPreamp: 0 dB\n";
    fs::write(&path, s).map_err(|e| format!("No se pudo limpiar EqAPO: {}", e))?;
    Ok(())
}
