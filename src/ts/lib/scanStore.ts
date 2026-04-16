// ts/lib/scanStore.ts
import { create } from 'zustand'

interface ScanStore {
  scanVersion: number        // 増えるたびにLibraryPageが再取得
  scanning: boolean
  notifyScanCompleted: () => void
  setScanningFlag: (v: boolean) => void
}

export const useScanStore = create<ScanStore>(set => ({
  scanVersion: 0,
  scanning: false,
  notifyScanCompleted: () => set(s => ({ scanVersion: s.scanVersion + 1, scanning: false })),
  setScanningFlag: (v) => set({ scanning: v }),
}))