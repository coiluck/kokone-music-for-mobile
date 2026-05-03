import { useEffect, useState } from 'react'
import type { SvgIconName } from '../lib/playlistIcon'

// fetch結果（生のSVG文字列）をPromiseのままキャッシュ
const templateCache = new Map<SvgIconName, Promise<string>>()

function loadTemplate(name: SvgIconName): Promise<string> {
  let p = templateCache.get(name)
  if (!p) {
    p = fetch(`/images/listIcons/${name}.svg`).then(r => r.text())
    templateCache.set(name, p)
  }
  return p
}

// __key__ を実際の色に置換
function applyColors(template: string, colors: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(colors)) {
    out = out.split(`__${key}__`).join(value)
  }
  return out
}

type Props = {
  name: SvgIconName
  colors: Record<string, string>
  size: number
}

export function ColoredSvg({ name, colors, size }: Props) {
  const [template, setTemplate] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTemplate(name).then(t => {
      if (!cancelled) setTemplate(t)
    })
    return () => { cancelled = true }
  }, [name])

  if (!template) {
    // ロード中はサイズを確保するだけのプレースホルダ
    return <div style={{ width: size, height: size, display: 'inline-block' }} />
  }

  const html = applyColors(template, colors)

  return (
    <div
      style={{ width: size, height: size, display: 'inline-block', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}