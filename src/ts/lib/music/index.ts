//   desktop  : desktop.ts  (HTMLAudioElement + Web Audio)
//   Android  : android.ts  (ネイティブの MusicPlaybackService)

import { isAndroid } from '../platform'
import { NativeAndroidMusicPlayer } from './android'
import { DesktopMusicPlayer } from './desktop'
import type { MusicPlayer } from './queuedPlayer'

export type { MusicPlayer }

export const musicPlayer: MusicPlayer = isAndroid()
  ? new NativeAndroidMusicPlayer()
  : new DesktopMusicPlayer()
