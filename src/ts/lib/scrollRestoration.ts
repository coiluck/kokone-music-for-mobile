import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import type { VirtualItem } from '@tanstack/react-virtual'

const STORAGE_PREFIX = 'kokone:scrollPos:'
const VIRTUAL_OFFSET_PREFIX = 'kokone:vScrollOffset:'
const VIRTUAL_CACHE_PREFIX = 'kokone:vMeasurementsCache:'
const RESTORE_TIMEOUT_MS = 1000

export function loadScrollPosition(pathname: string): number | null {
  try {
    const v = sessionStorage.getItem(STORAGE_PREFIX + pathname)
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function saveScrollPosition(pathname: string, top: number): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + pathname, String(top))
  } catch {
    // noop
  }
}

interface Options {
  /**
   * 復元してよいかどうか。
   * - スクロール要素自体が条件付きで描画されるページ (Library / Artist) では
   *   要素がマウントされた後 (= !loading) に true にする。
   * - 要素が常に描画されるページ (Album / Playlists / Tags / Settings) では
   *   true 固定でよい。中身の高さが遅れて確定しても、フックが scrollHeight を
   *   見ながら再試行する。
   */
  ready: boolean
}

/**
 * pathname ごとに渡された要素の scrollTop を sessionStorage に保存・復元する。
 *
 * - 要素は overflow:auto なスクロール要素を渡す。
 * - virtualizer ページでも getScrollElement と同じ要素の ref を渡せばよい。
 *   scrollTop を直接書けば virtualizer 側が scroll イベントを拾う。
 * - データ再ロードで要素が再マウントされたケースでも、新しい DOM 要素を
 *   検知して再復元する。
 */
export function useScrollRestoration(
  ref: React.RefObject<HTMLElement | null>,
  { ready }: Options,
): void {
  const { pathname } = useLocation()
  // (pathname, element) の組ごとに 1 回だけ復元するためのガード
  const restoredFor = useRef<{ pathname: string; el: HTMLElement } | null>(null)

  useLayoutEffect(() => {
    if (!ready) return
    const el = ref.current
    if (!el) return

    let restoreRafId = 0

    // --- 復元 ---
    const last = restoredFor.current
    if (!last || last.pathname !== pathname || last.el !== el) {
      restoredFor.current = { pathname, el }
      const saved = loadScrollPosition(pathname)
      if (saved != null && saved > 0) {
        // virtualizer の measure 遅延や、データ fetch 後の高さ確定が間に合わず
        // scrollHeight が saved に届かない場合に備え、必要な高さに達するまで
        // rAF で再試行する (上限 RESTORE_TIMEOUT_MS)。
        const start = performance.now()
        const tryRestore = () => {
          const cur = ref.current
          if (!cur) return
          const maxScroll = cur.scrollHeight - cur.clientHeight
          if (maxScroll >= saved || performance.now() - start > RESTORE_TIMEOUT_MS) {
            cur.scrollTop = saved
            return
          }
          restoreRafId = requestAnimationFrame(tryRestore)
        }
        tryRestore()
      }
    }

    // --- 保存 (rAF で間引き、cleanup で必ず flush) ---
    let saveRafId = 0
    let pending = false
    let lastTop = el.scrollTop

    const onScroll = () => {
      lastTop = el.scrollTop
      if (pending) return
      pending = true
      saveRafId = requestAnimationFrame(() => {
        pending = false
        saveRafId = 0
        saveScrollPosition(pathname, lastTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (saveRafId) cancelAnimationFrame(saveRafId)
      if (restoreRafId) cancelAnimationFrame(restoreRafId)
      // 直近の値を確実に書き出す (rAF 待機中の値が捨てられないように)
      saveScrollPosition(pathname, lastTop)
    }
  }, [ready, pathname, ref])
}

// ---------------------------------------------------------------------------
// virtualizer (@tanstack/react-virtual) 用の復元ヘルパー
//
// `initialOffset` だけだと measureElement で実測したサイズが戻らないため、
// 復元位置に「予想と違うサイズ」のアイテムが並んでしまい、表示が崩れる /
// scrollOffset が clamp される。`initialMeasurementsCache` も復元するのが
// 公式に推奨されているパターン。
// ---------------------------------------------------------------------------

export interface VirtualizerInitialState {
  initialOffset: number
  initialMeasurementsCache: VirtualItem[]
}

export function loadVirtualizerInitial(pathname: string): VirtualizerInitialState {
  let initialOffset = 0
  let initialMeasurementsCache: VirtualItem[] = []
  try {
    const o = sessionStorage.getItem(VIRTUAL_OFFSET_PREFIX + pathname)
    if (o != null) {
      const n = Number(o)
      if (Number.isFinite(n) && n > 0) initialOffset = n
    }
    const c = sessionStorage.getItem(VIRTUAL_CACHE_PREFIX + pathname)
    if (c != null) {
      const parsed = JSON.parse(c) as unknown
      if (Array.isArray(parsed)) initialMeasurementsCache = parsed as VirtualItem[]
    }
  } catch {
    // noop
  }
  return { initialOffset, initialMeasurementsCache }
}

export function saveVirtualizerState(
  pathname: string,
  scrollOffset: number | null,
  measurementsCache: VirtualItem[],
): void {
  try {
    if (scrollOffset != null && scrollOffset >= 0) {
      sessionStorage.setItem(VIRTUAL_OFFSET_PREFIX + pathname, String(scrollOffset))
    }
    if (measurementsCache.length > 0) {
      sessionStorage.setItem(
        VIRTUAL_CACHE_PREFIX + pathname,
        JSON.stringify(measurementsCache),
      )
    }
  } catch {
    // noop
  }
}
