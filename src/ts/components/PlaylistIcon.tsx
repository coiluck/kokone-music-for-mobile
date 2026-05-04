import { Icon } from './Icon'
import { ColoredSvg } from './ColoredSvg'
import {
  getSvgColors,
  getIdenticonColors,
  hashString,
  type PlaylistIcon as PlaylistIconData,
} from '../lib/playlistIcon'

type Props = {
  icon: PlaylistIconData | null
  name: string         // identicon の seed に使う
  size: number
  iconStyle?: string | null  // null時のフォールバック用
}

export function PlaylistIcon({ icon, name, size, iconStyle = null }: Props) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        backgroundColor: '#fff',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <PlaylistIconInner icon={icon} name={name} size={size} iconStyle={iconStyle} />
    </span>
  )
}

function PlaylistIconInner({ icon, name, size, iconStyle }: Props) {
  if (!icon) {
    return (
      <Icon
        name="playlist"
        mode={iconStyle as never}
        size={size}
        folder="/images/PlaylistsPage/"
      />
    )
  }

  if (icon.kind === 'svg') {
    const colors = getSvgColors(icon.name, icon.hue)
    return <ColoredSvg name={icon.name} colors={colors} size={size} />
  }

  // identicon (kind: 'auto')
  return <IdenticonSvg seed={name} hue={icon.hue} size={size} />
}

function IdenticonSvg({ seed, hue, size }: { seed: string; hue: number; size: number }) {
  const { fg, bg } = getIdenticonColors(hue)
  const h = hashString(seed)
  // 5x5 の左半分（3列 x 5行 = 15bit）を hash から取って、右にミラー
  const cells: boolean[] = []
  for (let i = 0; i < 15; i++) {
    cells.push(((h >> i) & 1) === 1)
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      style={{ display: 'inline-block' }}
    >
      <rect width="5" height="5" fill={bg} />
      {cells.map((on, i) => {
        if (!on) return null
        const col = Math.floor(i / 5)
        const row = i % 5
        return (
          <g key={i} fill={fg}>
            <rect x={col} y={row} width="1" height="1" />
            {col !== 2 && <rect x={4 - col} y={row} width="1" height="1" />}
          </g>
        )
      })}
    </svg>
  )
}