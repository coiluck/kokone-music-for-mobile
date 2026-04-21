import { useScanStore } from '../lib/scanStore'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/components/ScanMessage.css'

function ScanIcon({ step, current, total }: {
  step: string
  current: number
  total: number
}) {
  if (step === 'analyzing') {
    const angle = total > 0 ? (current / total) * 360 : 0
    const r = 10
    const cx = 14
    const cy = 14
    const rad = (a: number) => (a - 90) * (Math.PI / 180)
    const x1 = cx + r * Math.cos(rad(0))
    const y1 = cy + r * Math.sin(rad(0))
    const x2 = cx + r * Math.cos(rad(angle))
    const y2 = cy + r * Math.sin(rad(angle))
    const largeArc = angle > 180 ? 1 : 0

    return (
      <svg className="sm-component-icon sm-component-icon-progress" width="28" height="28" viewBox="0 0 28 28">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.5} />
        {angle >= 360 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={2.5} />
        ) : angle > 0 ? (
          <path
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    )
  }

  // scanning / deleting / adding → マウスカーソル風スピナー
  return (
    <svg className="sm-component-icon sm-component-icon-spinner" width="28" height="28" viewBox="0 0 28 28">
      <circle
        cx="14" cy="14" r="10"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={2.5}
      />
      <circle
        cx="14" cy="14" r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="16 47"
        strokeDashoffset="0"
      />
    </svg>
  )
}

export function ScanMessage() {
  const scanning    = useScanStore(s => s.scanning)
  const processStep = useScanStore(s => s.processStep)
  const scanCurrent = useScanStore(s => s.scanCurrent)
  const scanTotal   = useScanStore(s => s.scanTotal)
  const addCurrent  = useScanStore(s => s.addCurrent)
  const addTotal    = useScanStore(s => s.addTotal)
  const currentFile = useScanStore(s => s.currentFile)

  const t = useMappedTranslations({
    scanning:  'scan.step.scanning',
    deleting:  'scan.step.deleting',
    adding:    'scan.step.adding',
    analyzing: 'scan.step.analyzing',
    files:     'scan.unit.files',
  })

  const current = processStep === 'scanning'  ? scanCurrent
                : processStep === 'adding'    ? addCurrent
                : processStep === 'analyzing' ? addCurrent
                : 0
  const total   = processStep === 'scanning'  ? scanTotal
                : processStep === 'adding'    ? addTotal
                : processStep === 'analyzing' ? addTotal
                : 0

  const stepLabels: Record<string, string> = {
    scanning:  t.scanning,
    deleting:  t.deleting,
    adding:    t.adding,
    analyzing: t.analyzing,
  }
  const label = stepLabels[processStep] ?? ''

  const countText = processStep === 'scanning'
    ? `${scanCurrent} ${t.files}`
    : total > 0
    ? `${current} / ${total}`
    : ''

  return (
    <div className={`sm-component-container${scanning ? ' active' : ''}`}>
      {scanning && processStep && (
        <ScanIcon step={processStep} current={current} total={total} />
      )}
      <div className="sm-component-text">
        {scanning && label && (
          <>
            <span className="sm-component-step-label">{label}</span>
            {countText && <span className="sm-component-step-count">{countText}</span>}
            {currentFile && (
              <span className="sm-component-current-file" title={currentFile}>
                {currentFile.split('/').pop() ?? currentFile}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}