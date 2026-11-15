import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getListeningClock,
  getListeningHeatmap,
  getTopListening,
  getTotalListeningMs,
  type ListeningClock,
  type ListeningDay,
  type TopListening,
  type TopTag,
} from '../../lib/db'
import { useMappedTranslations } from '../../lib/i18n'
import { useSettingsStore } from '../../lib/settingsStore'
import HeaderSub from '../../components/HeaderSub'
import '../../../css/pages/sub/StatsPage.css'

// 翻訳文字列の {placeholder} を埋める
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
}

const SIZE = 260
const CENTER = SIZE / 2
const MAX_R = CENTER - 16
const SLOT = (Math.PI * 2) / 24
const GAP = SLOT * 0.14

// 12時方向を0時として時計回り
function polar(r: number, angle: number): [number, number] {
  return [CENTER + r * Math.sin(angle), CENTER - r * Math.cos(angle)]
}

function wedgePath(hour: number, r: number): string {
  const a0 = hour * SLOT + GAP / 2
  const a1 = (hour + 1) * SLOT - GAP / 2
  const [x0, y0] = polar(r, a0)
  const [x1, y1] = polar(r, a1)
  return `M ${CENTER} ${CENTER} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ClockChart({
  values,
  caption,
  tooltip,
}: {
  values: number[]
  caption: string
  tooltip: string // {range} と {count} を含むテンプレート
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ hour: number; x: number; y: number } | null>(null)

  const max = Math.max(...values)

  const handleMove = (hour: number) => (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ hour, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div className='stats-clock'>
      <div className='stats-clock-canvas' ref={wrapRef}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className='stats-clock-svg'>
          <g className='stats-clock-grid'>
            {values.map((_, hour) => {
              const [x, y] = polar(MAX_R, hour * SLOT)
              return <line key={hour} x1={CENTER} y1={CENTER} x2={x} y2={y} />
            })}
          </g>
          <g className='stats-clock-wedges'>
            {values.map((v, hour) => {
              if (max <= 0 || v <= 0) return null
              const ratio = v / max
              return (
                <path
                  key={hour}
                  d={wedgePath(hour, ratio * MAX_R)}
                  opacity={0.45 + 0.55 * ratio}
                />
              )
            })}
          </g>
          <g className='stats-clock-hit'>
            {values.map((_, hour) => (
              <path
                key={hour}
                d={wedgePath(hour, MAX_R)}
                onMouseMove={handleMove(hour)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
        {hover && (
          <div className='stats-clock-tooltip' style={{ left: hover.x, top: hover.y }}>
            {fill(tooltip, {
              range: `${pad(hover.hour)}:00 - ${pad((hover.hour + 1) % 24)}:00`,
              count: Math.round(values[hover.hour]),
            })}
          </div>
        )}
      </div>
      <span className='stats-clock-caption'>{caption}</span>
    </div>
  )
}

// 日曜始まりの曜日名。1970-01-04 (ローカル) は日曜
function weekdayNames(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(1970, 0, 4 + i)))
}

// 英語の序数。他の言語は翻訳側で {dayOrdinal} を使わない
function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  if (n % 10 === 1) return `${n}st`
  if (n % 10 === 2) return `${n}nd`
  if (n % 10 === 3) return `${n}rd`
  return `${n}th`
}

function HeatmapChart({ days }: { days: ListeningDay[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)

  const lang = useSettingsStore(s => s.lang)
  const t = useMappedTranslations({
    date: 'stats.calendar.date',
    zero: 'stats.calendar.tooltip.zero',
    one: 'stats.calendar.tooltip.one',
    other: 'stats.calendar.tooltip.other',
  })
  const weekdays = useMemo(() => weekdayNames(lang), [lang])
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'long' }), [lang])

  const dayLabel = (day: ListeningDay): string => {
    const d = new Date(day.date)
    const date = fill(t.date, {
      month: monthFmt.format(d),
      day: d.getDate(),
      dayOrdinal: ordinal(d.getDate()),
    })
    const template = day.streams === 0 ? t.zero : day.streams === 1 ? t.one : t.other
    return fill(template, { date, count: day.streams })
  }

  const max = Math.max(...days.map(d => d.streams))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 基本はセルの真上。画面端32px以内の時だけ横にずらす
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip) return
    tip.style.transform = 'translate(-50%, -120%)'

    const margin = 32
    const rect = tip.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth

    let shift = 0
    if (rect.right > viewportWidth - margin) shift = (viewportWidth - margin) - rect.right
    else if (rect.left < margin) shift = margin - rect.left

    if (shift !== 0) tip.style.transform = `translate(calc(-50% + ${shift}px), -120%)`
  }, [hover, t])

  const handleEnter = (index: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const cell = e.currentTarget.getBoundingClientRect()
    const rect = wrap.getBoundingClientRect()
    setHover({
      index,
      x: cell.left - rect.left + cell.width / 2,
      y: cell.top - rect.top,
    })
  }

  return (
    <div className='stats-heatmap' ref={wrapRef}>
      <div className='stats-heatmap-grid'>
        {weekdays.map((w, i) => (
          <span key={i} className='stats-heatmap-weekday'>{w}</span>
        ))}
        {days.map((day, index) => {
          const future = day.date > today.getTime()
          return (
            <div
              key={day.date}
              className={future ? 'stats-heatmap-cell future' : 'stats-heatmap-cell'}
              style={day.streams > 0 ? {
                backgroundColor:
                  `rgb(from var(--color-accent) r g b / ${0.25 + 0.75 * (day.streams / max)})`,
              } : undefined}
              onMouseEnter={future ? undefined : handleEnter(index)}
              onMouseLeave={future ? undefined : () => setHover(null)}
            />
          )
        })}
      </div>
      {hover && (
        <div
          className='stats-heatmap-tooltip'
          ref={tipRef}
          style={{ left: hover.x, top: hover.y }}
        >
          {dayLabel(days[hover.index])}
        </div>
      )}
    </div>
  )
}

const RADAR_AXES = 6
const RADAR_R = 82
const RADAR_SLOT = (Math.PI * 2) / RADAR_AXES
const RADAR_LABEL_LENGTH = 7
const RADAR_LINE_HEIGHT = 13

function radarPoints(ratio: (axis: number) => number): string {
  return Array.from({ length: RADAR_AXES }, (_, axis) =>
    polar(RADAR_R * ratio(axis), axis * RADAR_SLOT).join(',')
  ).join(' ')
}

function radarLabel(tag: string): string {
  return tag.length > RADAR_LABEL_LENGTH ? `${tag.slice(0, RADAR_LABEL_LENGTH - 1)}…` : tag
}

function RadarChart({
  tags,
  formatCount,
}: {
  tags: TopTag[]
  formatCount: (count: number) => string
}) {
  // 順位順だと毎回同じ渦巻き形になるので名前順に置く
  const axes = [...tags].sort((a, b) => a.tag.localeCompare(b.tag, 'ja'))
  while (axes.length < RADAR_AXES) axes.push({ tag: '---', count: 0 })

  const max = Math.max(...axes.map(a => a.count))

  return (
    <div className='stats-radar'>
      <svg viewBox='-30 16 320 228' className='stats-radar-svg'>
        {[0.25, 0.5, 0.75, 1].map(ratio => (
          <polygon
            key={ratio}
            className={ratio === 1 ? 'stats-radar-web outer' : 'stats-radar-web'}
            points={radarPoints(() => ratio)}
          />
        ))}
        {axes.map((_, axis) => {
          const [x, y] = polar(RADAR_R, axis * RADAR_SLOT)
          return <line key={axis} className='stats-radar-spoke' x1={CENTER} y1={CENTER} x2={x} y2={y} />
        })}
        <polygon className='stats-radar-shape' points={radarPoints(axis => axes[axis].count / max)} />
        {axes.map(({ tag, count }, axis) => {
          const angle = axis * RADAR_SLOT
          const [dotX, dotY] = polar(RADAR_R * (count / max), angle)
          const [labelX, labelY] = polar(RADAR_R + 10, angle)
          const sin = Math.sin(angle)
          const anchor = Math.abs(sin) < 0.01 ? 'middle' : sin > 0 ? 'start' : 'end'
          // 2行のラベルが頂点に重ならないよう、上下の軸では外側へ寄せる
          const top = labelY - (Math.cos(angle) + 1) * RADAR_LINE_HEIGHT / 2
          return (
            <g key={axis}>
              {count > 0 && <circle className='stats-radar-dot' cx={dotX} cy={dotY} r={4} />}
              <text className='stats-radar-label' x={labelX} y={top} textAnchor={anchor}>
                {radarLabel(tag)}
              </text>
              <text
                className='stats-radar-count'
                x={labelX}
                y={top + RADAR_LINE_HEIGHT}
                textAnchor={anchor}
              >
                {formatCount(count)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function StatsPage() {
  const [clock, setClock] = useState<ListeningClock | null>(null)
  const [heatmap, setHeatmap] = useState<ListeningDay[] | null>(null)
  const [totalMs, setTotalMs] = useState(0)
  const [top, setTop] = useState<TopListening>({ tracks: [], tags: [] })
  const navigate = useNavigate()

  const t = useMappedTranslations({
    title: 'stats.title',
    totalTitle: 'stats.totalTime.title',
    totalDesc: 'stats.totalTime.desc',
    totalValue: 'stats.totalTime.value',
    topTracksTitle: 'stats.topTracks.title',
    topTracksDesc: 'stats.topTracks.desc',
    topTagsTitle: 'stats.topTags.title',
    topTagsDesc: 'stats.topTags.desc',
    playsOne: 'stats.plays.one',
    playsOther: 'stats.plays.other',
    calendarTitle: 'stats.calendar.title',
    calendarDesc: 'stats.calendar.desc',
    clocksTitle: 'stats.clocks.title',
    clocksDesc: 'stats.clocks.desc',
    tracksCaption: 'stats.clocks.caption.tracks',
    minutesCaption: 'stats.clocks.caption.minutes',
    tracksTooltip: 'stats.clocks.tooltip.tracks',
    minutesTooltip: 'stats.clocks.tooltip.minutes',
  })

  useEffect(() => {
    void getListeningClock().then(setClock)
    void getListeningHeatmap().then(setHeatmap)
    void getTotalListeningMs().then(setTotalMs)
    void getTopListening().then(setTop)
  }, [])

  const formatPlays = (count: number) => fill(count === 1 ? t.playsOne : t.playsOther, { count })

  return (
    <>
      <HeaderSub title={t.title} onBack={() => navigate(-1)} />

      <div className='page page-stats fade-in'>
        <section className='stats-section'>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div className='stats-section-header'>
              <h2 className='stats-section-title'>{t.totalTitle}</h2>
              <p className='stats-section-desc'>
                {t.totalDesc}
              </p>
             </div>
            <p>
              {fill(t.totalValue, {
                hours: Math.floor(totalMs / 3600000),
                minutes: Math.floor((totalMs % 3600000) / 60000),
              })}
            </p>
          </div>
        </section>

        {top.tracks.length !== 0 && (
          <section className='stats-section'>
            <div className='stats-section-header'>
              <h2 className='stats-section-title'>{t.topTracksTitle}</h2>
              <p className='stats-section-desc'>
                {t.topTracksDesc}
              </p>
            </div>
            <ol className='stats-top-tracks'>
              {top.tracks.map(({ track, count }, index) => (
                <li key={track.id} className='stats-top-track'>
                  <div className='stats-top-track-row'>
                    <span className='stats-top-track-rank'>{index + 1}</span>
                    <div className='stats-top-track-text'>
                      <p className='stats-top-track-title'>{track.title}</p>
                      <p className='stats-top-track-artist'>{track.artist}</p>
                    </div>
                    <span className='stats-top-track-count'>{formatPlays(count)}</span>
                  </div>
                  <div className='stats-top-track-bar'>
                    <div style={{ width: `${(count / top.tracks[0].count) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {top.tags.length !== 0 && (
          <section className='stats-section'>
            <div className='stats-section-header'>
              <h2 className='stats-section-title'>{t.topTagsTitle}</h2>
              <p className='stats-section-desc'>
                {t.topTagsDesc}
              </p>
            </div>
            <RadarChart tags={top.tags} formatCount={formatPlays} />
          </section>
        )}

        <section className='stats-section'>
          <div className='stats-section-header'>
            <h2 className='stats-section-title'>{t.calendarTitle}</h2>
            <p className='stats-section-desc'>
              {t.calendarDesc}
            </p>
          </div>
          {heatmap && <HeatmapChart days={heatmap} />}
        </section>

        <section className='stats-section'>
          <div className='stats-section-header'>
            <h2 className='stats-section-title'>{t.clocksTitle}</h2>
            <p className='stats-section-desc'>
              {t.clocksDesc}
            </p>
          </div>
          {clock && (
            <div className='stats-clocks'>
              <ClockChart
                values={clock.streams}
                caption={t.tracksCaption}
                tooltip={t.tracksTooltip}
              />
              <ClockChart
                values={clock.minutes}
                caption={t.minutesCaption}
                tooltip={t.minutesTooltip}
              />
            </div>
          )}
        </section>
      </div>
    </>
  )
}
