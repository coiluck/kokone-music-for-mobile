// ts/lib/scanStore.ts
import { create } from 'zustand'

// 段階は src-tauri/src/scan/progress.rs での定義と一緒
export type ScanStep = 'scanning' | 'deleting' | 'adding' | 'analyzing'

// scan-progress イベントの中身 (progress.rs の ScanProgress)
export interface ScanProgressPayload {
  process_step: ScanStep
  scan_current: number
  scan_total: number
  add_current: number
  add_total: number
  analyze_current: number
  analyze_total: number
  current_file: string
}

interface ScanStore {
  scanVersion: number
  scanning: boolean
  processStep: ScanStep | ''
  scanCurrent: number
  scanTotal: number
  addCurrent: number
  addTotal: number
  analyzeCurrent: number
  analyzeTotal: number
  notifyScanCompleted: () => void
  setScanningFlag: (v: boolean) => void
  setScanProgress: (p: ScanProgressPayload) => void
}

const initialProgress = {
  processStep: '' as const,
  scanCurrent: 0,
  scanTotal: 0,
  addCurrent: 0,
  addTotal: 0,
  analyzeCurrent: 0,
  analyzeTotal: 0,
}

export const useScanStore = create<ScanStore>(set => ({
  scanVersion: 0,
  scanning: false,
  ...initialProgress,
  // 画面の読み直し時期を知らせるだけ。scanning は scan.ts が解析の完了まで立てておく
  notifyScanCompleted: () => set(s => ({ scanVersion: s.scanVersion + 1 })),
  // 開始時は前回の進捗を消す
  setScanningFlag: (v) => set(v ? { scanning: true, ...initialProgress } : { scanning: false }),
  setScanProgress: (p) => set({
    processStep: p.process_step,
    scanCurrent: p.scan_current,
    scanTotal: p.scan_total,
    addCurrent: p.add_current,
    addTotal: p.add_total,
    analyzeCurrent: p.analyze_current,
    analyzeTotal: p.analyze_total,
  }),
}))
