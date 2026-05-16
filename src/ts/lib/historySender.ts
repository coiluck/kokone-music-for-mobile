// ts/lib/historySender.ts
import { useSettingsStore } from './settingsStore'
import { invoke } from '@tauri-apps/api/core'

interface HistoryPayload {
  title: string
  artist: string
  playedAt: string // ISO 8601
}

// 送信フォーマット:
//   Firebase (Firestore REST API):
//     POST https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/{collection}?key={apiKey}
//     Body: { fields: { title: { stringValue }, artist: { stringValue }, playedAt: { timestampValue } } }
//
//   Cloudflare D1 (任意の Worker エンドポイント想定):
//     POST {endpoint}
//     Header: Authorization: Bearer {apiToken}   (apiToken が空なら付けない)
//     Body:   { title, artist, playedAt }   (JSON)

export function sendPlayHistory(title: string, artist: string | null | undefined): void {
  const s = useSettingsStore.getState()
  if (!s.isDeveloperMode) return
  if (!s.isSendHistory) return

  const payload: HistoryPayload = {
    title,
    artist: artist ?? '',
    playedAt: new Date().toISOString(),
  }

  if (s.historyBackend === 'firebase') {
    void sendToFirebase(payload, s.firebaseConfig).catch(err => {
      console.error('[historySender] firebase send failed:', err)
    })
  } else if (s.historyBackend === 'cloudflare-d1') {
    void sendToCloudflareD1(payload, s.cloudflareD1Config).catch(err => {
      console.error('[historySender] cloudflare d1 send failed:', err)
    })
  }
}

async function sendToFirebase(
  payload: HistoryPayload,
  config: { projectId: string; apiKey: string; collection: string },
): Promise<void> {
  if (!config.projectId || !config.apiKey || !config.collection) {
    console.warn('[historySender] firebase config incomplete; skipping')
    return
  }
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}` +
    `/databases/(default)/documents/${encodeURIComponent(config.collection)}` +
    `?key=${encodeURIComponent(config.apiKey)}`
  const body = {
    fields: {
      title:    { stringValue:    payload.title    },
      artist:   { stringValue:    payload.artist   },
      playedAt: { timestampValue: payload.playedAt },
    },
  }
  await invoke('send_history_http', {
    req: {
      url,
      headers: {},
      body: JSON.stringify(body),
    },
  })
}

async function sendToCloudflareD1(
  payload: HistoryPayload,
  config: { endpoint: string; apiToken: string },
): Promise<void> {
  if (!config.endpoint) {
    console.warn('[historySender] cloudflare endpoint not set; skipping')
    return
  }
  const headers: Record<string, string> = {}
  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`
  }
  await invoke('send_history_http', {
    req: {
      url: config.endpoint,
      headers,
      body: JSON.stringify(payload),
    },
  })
}