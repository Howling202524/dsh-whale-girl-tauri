#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarBootstrap {
    endpoint: String,
    token: String,
    harness_url: String,
    show_on_start: bool,
    always_on_top: bool,
    scale: f64,
    min_scale: f64,
    max_scale: f64,
    scale_step: f64,
    gaze_radius_bodies: f64,
    gaze_hysteresis_degrees: f64,
    window_width: f64,
    window_height: f64,
    poll_interval_ms: u64,
    request_timeout_ms: u64,
    max_consecutive_failures: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetActivity {
    name: String,
    until: f64,
    session_think: bool,
    session_wait: bool,
    turn_completed: bool,
}

#[derive(Clone, Deserialize, Serialize)]
struct PetActivitySnapshot {
    activity: PetActivity,
}

impl Default for PetActivitySnapshot {
    fn default() -> Self {
        Self {
            activity: PetActivity {
                name: "idle".into(),
                until: 0.0,
                session_think: false,
                session_wait: false,
                turn_completed: false,
            },
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetPreferences {
    enabled: Option<bool>,
    x: Option<i32>,
    y: Option<i32>,
    scale: Option<f64>,
    scale_set_by_user: Option<bool>,
    always_on_top: Option<bool>,
}

#[derive(Default)]
struct DragState {
    active: bool,
    moved: bool,
    origin_x: i32,
    origin_y: i32,
    last_x: i32,
}

struct RuntimeState {
    bootstrap: SidecarBootstrap,
    preferences_path: PathBuf,
    preferences: Mutex<PetPreferences>,
    snapshot: Mutex<PetActivitySnapshot>,
    gaze: Mutex<Option<u8>>,
    drag: Mutex<DragState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UiPreferences {
    always_on_top: bool,
    scale: f64,
    min_scale: f64,
    max_scale: f64,
    scale_step: f64,
    default_scale: f64,
}

#[derive(Clone, Serialize)]
struct DragResult {
    moved: bool,
}

fn read_bootstrap() -> Result<SidecarBootstrap, String> {
    let encoded = env::var("DSH_WHALE_GIRL_BOOTSTRAP")
        .map_err(|_| "missing DSH_WHALE_GIRL_BOOTSTRAP".to_owned())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|error| format!("invalid bootstrap encoding: {error}"))?;
    let bootstrap: SidecarBootstrap = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid bootstrap JSON: {error}"))?;
    if !bootstrap.endpoint.starts_with("http://127.0.0.1:") || bootstrap.token.is_empty() {
        return Err("bootstrap endpoint must be an authenticated IPv4 loopback URL".into());
    }
    if !bootstrap.scale.is_finite()
        || bootstrap.scale <= 0.0
        || !bootstrap.min_scale.is_finite()
        || bootstrap.min_scale <= 0.0
        || !bootstrap.max_scale.is_finite()
        || bootstrap.max_scale <= 0.0
        || !bootstrap.scale_step.is_finite()
        || bootstrap.scale_step <= 0.0
        || !bootstrap.gaze_radius_bodies.is_finite()
        || bootstrap.gaze_radius_bodies <= 0.5
        || !bootstrap.gaze_hysteresis_degrees.is_finite()
        || bootstrap.gaze_hysteresis_degrees < 0.0
        || !bootstrap.window_width.is_finite()
        || bootstrap.window_width <= 0.0
        || !bootstrap.window_height.is_finite()
        || bootstrap.window_height <= 0.0
        || bootstrap.poll_interval_ms == 0
        || bootstrap.request_timeout_ms == 0
        || bootstrap.max_consecutive_failures == 0
    {
        return Err("bootstrap numeric fields must be positive and finite".into());
    }
    if bootstrap.min_scale >= bootstrap.max_scale
        || !(bootstrap.min_scale..=bootstrap.max_scale).contains(&bootstrap.scale)
        || bootstrap.scale_step > bootstrap.max_scale - bootstrap.min_scale
        || bootstrap.gaze_hysteresis_degrees >= 11.25
    {
        return Err("bootstrap interaction ranges are invalid".into());
    }
    Ok(bootstrap)
}

fn read_preferences(path: &Path) -> PetPreferences {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => PetPreferences::default(),
    }
}

fn write_preferences(state: &RuntimeState, window: &WebviewWindow) -> Result<(), String> {
    let mut preferences = state
        .preferences
        .lock()
        .map_err(|_| "preferences lock is poisoned".to_owned())?;
    if let Ok(position) = window.outer_position() {
        preferences.x = Some(position.x);
        preferences.y = Some(position.y);
    }
    let mut json = serde_json::to_string_pretty(&*preferences)
        .map_err(|error| format!("preferences serialization failed: {error}"))?;
    json.push('\n');
    if let Some(parent) = state.preferences_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("preferences directory creation failed: {error}"))?;
    }
    fs::write(&state.preferences_path, json)
        .map_err(|error| format!("preferences write failed: {error}"))
}

fn angular_distance(left: f64, right: f64) -> f64 {
    let difference = (left - right).abs() % 360.0;
    difference.min(360.0 - difference)
}

fn gaze_direction_from_vector(
    dx: f64,
    dy: f64,
    inside_pet: bool,
    previous: Option<u8>,
    outer_radius: f64,
    hysteresis: f64,
) -> Option<u8> {
    if inside_pet || dx.hypot(dy) > outer_radius {
        return None;
    }
    let step = 360.0 / 16.0;
    let angle = (dx.atan2(-dy).to_degrees() + 360.0) % 360.0;
    let candidate = ((angle / step).round() as u8) % 16;
    let Some(previous) = previous else {
        return Some(candidate);
    };
    let previous_centre = f64::from(previous) * step;
    if angular_distance(angle, previous_centre) <= step / 2.0 + hysteresis {
        Some(previous)
    } else {
        Some(candidate)
    }
}

fn resolved_scale(preferences: &PetPreferences, bootstrap: &SidecarBootstrap) -> f64 {
    if preferences.scale_set_by_user.unwrap_or(false) {
        preferences.scale.unwrap_or(bootstrap.scale)
    } else {
        bootstrap.scale
    }
    .clamp(bootstrap.min_scale, bootstrap.max_scale)
}

fn configure_window(window: &WebviewWindow, state: &RuntimeState) -> Result<(), String> {
    let bootstrap = &state.bootstrap;
    let mut preferences = state
        .preferences
        .lock()
        .map_err(|_| "preferences lock is poisoned".to_owned())?;
    let scale = resolved_scale(&preferences, bootstrap);
    let enabled = preferences.enabled.unwrap_or(bootstrap.show_on_start);
    let on_top = preferences.always_on_top.unwrap_or(bootstrap.always_on_top);
    preferences.enabled = Some(enabled);
    preferences.scale = Some(scale);
    preferences.scale_set_by_user.get_or_insert(false);
    preferences.always_on_top = Some(on_top);
    let saved_position = preferences.x.zip(preferences.y);
    drop(preferences);

    window
        .set_size(LogicalSize::new(
            bootstrap.window_width * scale,
            bootstrap.window_height * scale,
        ))
        .map_err(|error| format!("window resize failed: {error}"))?;
    window
        .set_always_on_top(on_top)
        .map_err(|error| format!("always-on-top setup failed: {error}"))?;

    if let Some((x, y)) = saved_position {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| format!("window restore failed: {error}"))?;
    } else if let Some(monitor) = window
        .primary_monitor()
        .map_err(|error| format!("primary monitor query failed: {error}"))?
    {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let window_size = window
            .outer_size()
            .map_err(|error| format!("window size query failed: {error}"))?;
        let x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - 28;
        let y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32 - 28;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| format!("initial window placement failed: {error}"))?;
    }

    write_preferences(state, window)
}

fn start_polling(app: tauri::AppHandle) {
    let bootstrap = app.state::<RuntimeState>().bootstrap.clone();
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_millis(bootstrap.request_timeout_ms))
            .build()
        {
            Ok(client) => client,
            Err(_) => {
                app.exit(1);
                return;
            }
        };
        let mut consecutive_failures = 0_u32;
        loop {
            if app.get_webview_window("main").is_none() {
                return;
            }
            let result: Result<Option<PetActivitySnapshot>, reqwest::Error> = async {
                let response = client
                    .get(format!("{}/state", bootstrap.endpoint))
                    .bearer_auth(&bootstrap.token)
                    .send()
                    .await?;
                if response.status() == reqwest::StatusCode::GONE {
                    return Ok(None);
                }
                let response = response.error_for_status()?;
                response.json::<PetActivitySnapshot>().await.map(Some)
            }
            .await;

            match result {
                Ok(Some(snapshot)) => {
                    consecutive_failures = 0;
                    if let Ok(mut current) = app.state::<RuntimeState>().snapshot.lock() {
                        *current = snapshot.clone();
                    }
                    let _ = app.emit_to("main", "pet-state", snapshot);
                }
                Ok(None) => {
                    app.exit(0);
                    return;
                }
                Err(_) => {
                    consecutive_failures += 1;
                    if consecutive_failures >= bootstrap.max_consecutive_failures {
                        app.exit(0);
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(bootstrap.poll_interval_ms)).await;
        }
    });
}

fn attach_window_tracking(app: &tauri::AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(position) = event {
            let state = app.state::<RuntimeState>();
            if let Ok(mut preferences) = state.preferences.lock() {
                preferences.x = Some(position.x);
                preferences.y = Some(position.y);
            }
            let direction = if let Ok(mut drag) = state.drag.lock() {
                if !drag.active {
                    None
                } else {
                    let delta = position.x - drag.last_x;
                    let origin_dx = f64::from(position.x - drag.origin_x);
                    let origin_dy = f64::from(position.y - drag.origin_y);
                    if origin_dx.hypot(origin_dy) > 4.0 {
                        drag.moved = true;
                    }
                    drag.last_x = position.x;
                    if delta < -1 {
                        Some("left")
                    } else if delta > 1 {
                        Some("right")
                    } else {
                        None
                    }
                }
            } else {
                None
            };
            if let Some(direction) = direction {
                let _ = event_window.emit("pet-drag", direction);
            }
        }
    });
}

#[tauri::command]
fn current_state(state: State<'_, RuntimeState>) -> Result<PetActivitySnapshot, String> {
    state
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|_| "activity snapshot lock is poisoned".to_owned())
}

#[tauri::command]
fn ui_preferences(state: State<'_, RuntimeState>) -> Result<UiPreferences, String> {
    state
        .preferences
        .lock()
        .map(|preferences| {
            let bootstrap = &state.bootstrap;
            UiPreferences {
                always_on_top: preferences.always_on_top.unwrap_or(bootstrap.always_on_top),
                scale: resolved_scale(&preferences, bootstrap),
                min_scale: bootstrap.min_scale,
                max_scale: bootstrap.max_scale,
                scale_step: bootstrap.scale_step,
                default_scale: bootstrap.scale,
            }
        })
        .map_err(|_| "preferences lock is poisoned".to_owned())
}

fn left_mouse_button_pressed() -> bool {
    // SAFETY: GetAsyncKeyState reads process-independent input state and has no pointer arguments.
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON)) as u16 & 0x8000 != 0 }
}

fn take_drag_result(state: &RuntimeState) -> Result<Option<DragResult>, String> {
    let mut drag = state
        .drag
        .lock()
        .map_err(|_| "drag lock is poisoned".to_owned())?;
    if !drag.active {
        return Ok(None);
    }
    drag.active = false;
    Ok(Some(DragResult { moved: drag.moved }))
}

fn finish_drag(window: &WebviewWindow, state: &RuntimeState) -> Result<(), String> {
    let Some(result) = take_drag_result(state)? else {
        return Ok(());
    };
    let clear_result = window
        .emit("pet-drag", Option::<&str>::None)
        .map_err(|error| format!("drag direction reset failed: {error}"));
    let end_result = window
        .emit("pet-drag-end", result)
        .map_err(|error| format!("drag completion event failed: {error}"));
    let preference_result = write_preferences(state, window);
    clear_result?;
    end_result?;
    preference_result
}

fn start_drag_release_monitor(window: WebviewWindow) {
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let state = app.state::<RuntimeState>();
            let active = state.drag.lock().map(|drag| drag.active).unwrap_or(false);
            if !active {
                return;
            }
            if !left_mouse_button_pressed() {
                if let Err(error) = finish_drag(&window, state.inner()) {
                    eprintln!("Whale Girl drag completion failed: {error}");
                }
                return;
            }
        }
    });
}

#[tauri::command]
fn begin_drag(window: WebviewWindow, state: State<'_, RuntimeState>) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("drag position query failed: {error}"))?;
    {
        let mut drag = state
            .drag
            .lock()
            .map_err(|_| "drag lock is poisoned".to_owned())?;
        *drag = DragState {
            active: true,
            moved: false,
            origin_x: position.x,
            origin_y: position.y,
            last_x: position.x,
        };
    }
    if let Err(error) = window.start_dragging() {
        if let Ok(mut drag) = state.drag.lock() {
            drag.active = false;
        }
        return Err(format!("native window drag failed: {error}"));
    }
    start_drag_release_monitor(window);
    Ok(())
}

#[tauri::command]
fn gaze_direction(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<Option<u8>, String> {
    if !window
        .is_visible()
        .map_err(|error| format!("window visibility query failed: {error}"))?
    {
        return Ok(None);
    }
    if state
        .drag
        .lock()
        .map_err(|_| "drag lock is poisoned".to_owned())?
        .active
    {
        return Ok(None);
    }
    let cursor = window
        .cursor_position()
        .map_err(|error| format!("cursor position query failed: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("window position query failed: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("window size query failed: {error}"))?;
    let dx = cursor.x - (f64::from(position.x) + f64::from(size.width) / 2.0);
    let dy = cursor.y - (f64::from(position.y) + f64::from(size.height) * 0.42);
    let inside_pet = cursor.x >= f64::from(position.x)
        && cursor.x <= f64::from(position.x) + f64::from(size.width)
        && cursor.y >= f64::from(position.y)
        && cursor.y <= f64::from(position.y) + f64::from(size.height);
    let outer_radius = f64::from(size.width.max(size.height)) * state.bootstrap.gaze_radius_bodies;
    let mut previous = state
        .gaze
        .lock()
        .map_err(|_| "gaze lock is poisoned".to_owned())?;
    *previous = gaze_direction_from_vector(
        dx,
        dy,
        inside_pet,
        *previous,
        outer_radius,
        state.bootstrap.gaze_hysteresis_degrees,
    );
    Ok(*previous)
}

#[tauri::command]
async fn renderer_ready(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(format!("{}/ready", state.bootstrap.endpoint))
        .bearer_auth(&state.bootstrap.token)
        .send()
        .await
        .map_err(|error| format!("renderer-ready request failed: {error}"))?;
    if response.status() != reqwest::StatusCode::NO_CONTENT {
        return Err(format!(
            "renderer-ready request failed with HTTP {}",
            response.status()
        ));
    }
    if state
        .preferences
        .lock()
        .map_err(|_| "preferences lock is poisoned".to_owned())?
        .enabled
        .unwrap_or(state.bootstrap.show_on_start)
    {
        window
            .show()
            .map_err(|error| format!("window show failed: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    value: bool,
) -> Result<(), String> {
    window
        .set_always_on_top(value)
        .map_err(|error| format!("always-on-top update failed: {error}"))?;
    state
        .preferences
        .lock()
        .map_err(|_| "preferences lock is poisoned".to_owned())?
        .always_on_top = Some(value);
    write_preferences(&state, &window)
}

#[tauri::command]
fn set_scale(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    value: f64,
) -> Result<f64, String> {
    if !value.is_finite()
        || !(state.bootstrap.min_scale..=state.bootstrap.max_scale).contains(&value)
    {
        return Err("pet scale is outside the configured range".into());
    }
    let position = window
        .outer_position()
        .map_err(|error| format!("scale position query failed: {error}"))?;
    let old_size = window
        .outer_size()
        .map_err(|error| format!("scale size query failed: {error}"))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("scale factor query failed: {error}"))?;
    let new_width = (state.bootstrap.window_width * value * scale_factor).round() as i32;
    let new_height = (state.bootstrap.window_height * value * scale_factor).round() as i32;
    let new_x = position.x + (old_size.width as i32 - new_width) / 2;
    let new_y = position.y + old_size.height as i32 - new_height;

    window
        .set_size(LogicalSize::new(
            state.bootstrap.window_width * value,
            state.bootstrap.window_height * value,
        ))
        .map_err(|error| format!("pet scale update failed: {error}"))?;
    window
        .set_position(PhysicalPosition::new(new_x, new_y))
        .map_err(|error| format!("pet scale anchoring failed: {error}"))?;
    {
        let mut preferences = state
            .preferences
            .lock()
            .map_err(|_| "preferences lock is poisoned".to_owned())?;
        preferences.scale = Some(value);
        preferences.scale_set_by_user = Some(true);
    }
    write_preferences(&state, &window)?;
    Ok(value)
}

#[tauri::command]
fn show_main(state: State<'_, RuntimeState>) -> Result<(), String> {
    webbrowser::open(&state.bootstrap.harness_url)
        .map_err(|error| format!("Harness URL could not be opened: {error}"))
}

#[tauri::command]
fn hide_pet(window: WebviewWindow, state: State<'_, RuntimeState>) -> Result<(), String> {
    window
        .hide()
        .map_err(|error| format!("window hide failed: {error}"))?;
    state
        .preferences
        .lock()
        .map_err(|_| "preferences lock is poisoned".to_owned())?
        .enabled = Some(false);
    write_preferences(&state, &window)
}

fn run() -> Result<(), String> {
    tauri::Builder::default()
        .setup(|app| {
            let bootstrap = read_bootstrap().map_err(std::io::Error::other)?;
            let preferences_path = app
                .path()
                .app_config_dir()
                .map_err(std::io::Error::other)?
                .join("preferences.json");
            let preferences = read_preferences(&preferences_path);
            app.manage(RuntimeState {
                bootstrap,
                preferences_path,
                preferences: Mutex::new(preferences),
                snapshot: Mutex::new(PetActivitySnapshot::default()),
                gaze: Mutex::new(None),
                drag: Mutex::new(DragState::default()),
            });
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("main window is missing"))?;
            configure_window(&window, &app.state::<RuntimeState>())
                .map_err(std::io::Error::other)?;
            attach_window_tracking(app.handle(), &window);
            start_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            begin_drag,
            current_state,
            gaze_direction,
            hide_pet,
            renderer_ready,
            set_always_on_top,
            set_scale,
            show_main,
            ui_preferences,
        ])
        .run(tauri::generate_context!())
        .map_err(|error| format!("Tauri runtime failed: {error}"))
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Whale Girl failed to start: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::gaze_direction_from_vector;

    #[test]
    fn gaze_sectors_follow_clockwise_up_zero_order() {
        assert_eq!(
            gaze_direction_from_vector(0.0, -200.0, false, None, 400.0, 4.0),
            Some(0)
        );
        assert_eq!(
            gaze_direction_from_vector(200.0, 0.0, false, None, 400.0, 4.0),
            Some(4)
        );
        assert_eq!(
            gaze_direction_from_vector(0.0, 200.0, false, None, 400.0, 4.0),
            Some(8)
        );
        assert_eq!(
            gaze_direction_from_vector(-200.0, 0.0, false, None, 400.0, 4.0),
            Some(12)
        );
        assert_eq!(
            gaze_direction_from_vector(10.0, 10.0, true, None, 400.0, 4.0),
            None
        );
        assert_eq!(
            gaze_direction_from_vector(500.0, 0.0, false, None, 400.0, 4.0),
            None
        );
    }
}
