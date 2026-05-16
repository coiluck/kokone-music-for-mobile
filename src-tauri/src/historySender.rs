use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct HistoryRequest {
    url: String,
    headers: HashMap<String, String>,
    body: String, // JSON文字列をそのまま渡す
}

#[tauri::command]
pub async fn send_history_http(req: HistoryRequest) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut builder = client.post(&req.url).body(req.body);

    for (k, v) in req.headers {
        builder = builder.header(&k, &v);
    }

    let res = builder
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }
    Ok(())
}