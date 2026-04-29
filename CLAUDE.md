# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (hot reload, port 1420)
npm run build      # TypeScript check + production build
npm run tauri dev  # Run full Tauri desktop app in development mode
npm run tauri build # Build distributable desktop app
```

No lint or test commands are configured.

## Architecture

Kokone Music is a Tauri 2 desktop app — a music library manager and player. The frontend is React 19 + TypeScript + Zustand, the backend is Rust, and the database is SQLite via the Tauri SQL plugin.

### Frontend (`src/ts/`)

**State is split by concern into Zustand stores:**
- `lib/playerStore.ts` — current playback state (track, queue, position, volume). Components read this; only `MusicPlayer` writes it.
- `lib/settingsStore.ts` — user preferences, persisted by calling Tauri commands on change.
- `lib/scanStore.ts` — file scan progress, updated from Tauri events.

**`lib/music.ts` — `MusicPlayer` class** manages the `HTMLAudioElement` imperatively (play, pause, fade, crossfade, queue). It writes to `playerStore` but is not itself a store — components don't call it directly through state.

**`lib/db.ts`** is the SQLite access layer, calling the Tauri SQL plugin. All DB reads from the frontend go through here.

**Routing** (`router.tsx`) uses React Router 7 with a nested layout: `App` is the root layout with `MiniPlayer` always visible. Settings is a separate top-level route without the common layout.

**LibraryPage** (`pages/LibraryPage.tsx`) uses TanStack Virtual for virtualized rendering of large track lists, with scroll position persisted across navigation.

### Backend (`src-tauri/src/`)

- **`scan_music.rs`** — directory traversal (WalkDir), metadata extraction (Lofty), SHA256 file hashing, SQLite insertion, progress event emission. Heavy work is parallelized with Rayon.
- **`audio_analysis.rs`** — LUFS loudness calculation (ebur128) and trailing silence detection. Runs async after initial DB insert.
- **`settings.rs`** — Tauri command handlers for get/set of persistent settings.
- **`lib.rs`** — registers all Tauri command handlers and initializes plugins.

### Database Schema

SQLite tables:
- `tracks` — music metadata, file hash, LUFS, duration, tags
- `playlists` — user playlists with track lists stored as JSON
- `taglists` — tag-based positive/negative filters
- `history` — play history

### Data Flow

1. User triggers scan → frontend calls Tauri command `music_scan_folders`
2. Rust scans directories, extracts metadata, runs parallel audio analysis → inserts into SQLite → emits progress events
3. Frontend receives events → updates `scanStore` → UI reflects progress
4. Playback: user action → `MusicPlayer` class → manages `HTMLAudioElement` + writes `playerStore` → components re-render

### Key Notes

- The app targets Japanese users; much of the codebase (comments, UI text) uses Japanese. i18n is handled in `lib/i18n.ts` (en/ja).
- Audio normalization (LUFS-based), crossfade, and trailing silence removal are first-class features — changes to audio playback must account for these.
- `MusicPlayer` is a singleton class; don't introduce parallel audio state management.
