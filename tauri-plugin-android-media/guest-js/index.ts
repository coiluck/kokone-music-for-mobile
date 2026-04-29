import { invoke } from '@tauri-apps/api/core'

export interface AudioMeta {
  id: number
  displayPath: string
  displayName: string
  title: string
  artist: string
  album: string
  durationMs: number
  sizeBytes: number
}

interface PermissionResponse {
  granted: boolean
}

interface QueryAudioMetadataResponse {
  items: AudioMeta[]
}

interface HashResponse {
  hash: string
}

export async function hasAudioPermission(): Promise<boolean> {
  const res = await invoke<PermissionResponse>(
    'plugin:android-media|has_audio_permission'
  )
  return res.granted
}

/**
 * Prompts the user for audio read permission. The returned promise resolves
 * after the user has accepted or denied the request — no polling needed.
 */
export async function requestAudioPermission(): Promise<boolean> {
  const res = await invoke<PermissionResponse>(
    'plugin:android-media|request_audio_permission'
  )
  return res.granted
}

export async function queryAudioMetadata(): Promise<AudioMeta[]> {
  const res = await invoke<QueryAudioMetadataResponse>(
    'plugin:android-media|query_audio_metadata'
  )
  return res.items
}

export async function audioHash(audioId: number, isMp3: boolean): Promise<string> {
  const res = await invoke<HashResponse>('plugin:android-media|audio_hash', {
    payload: { audioId, isMp3 },
  })
  return res.hash
}
