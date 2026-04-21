// ts/lib/scanStore.ts
import { create } from 'zustand'

export interface ScanProgressPayload {
  process_step: 'scanning' | 'adding'
  scan_current: number
  scan_total: number
  add_current: number
  add_total: number
  current_file: string
}

interface ScanStore {
  scanVersion: number
  scanning: boolean
  processStep: 'scanning' | 'deleting' | 'adding' | 'analyzing' | ''
  scanCurrent: number
  scanTotal: number
  addCurrent: number
  addTotal: number
  currentFile: string
  notifyScanCompleted: () => void
  setScanningFlag: (v: boolean) => void
  setScanProgress: (p: ScanProgressPayload) => void
}

export const useScanStore = create<ScanStore>(set => ({
  scanVersion: 0,
  scanning: false,
  processStep: '',
  scanCurrent: 0,
  scanTotal: 0,
  addCurrent: 0,
  addTotal: 0,
  currentFile: '',
  notifyScanCompleted: () => set(s => ({ scanVersion: s.scanVersion + 1, scanning: false })),
  setScanningFlag: (v) => set({ scanning: v }),
  setScanProgress: (p) => set({
    processStep: p.process_step,
    scanCurrent: p.scan_current,
    scanTotal: p.scan_total,
    addCurrent: p.add_current,
    addTotal: p.add_total,
    currentFile: p.current_file,
  }),
}))