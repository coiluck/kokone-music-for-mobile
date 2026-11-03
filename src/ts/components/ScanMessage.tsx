import { useScanStore } from '../lib/scanStore'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/components/ScanMessage.css'

export function ScanMessage() {
  const scanning       = useScanStore(s => s.scanning)
  const processStep    = useScanStore(s => s.processStep)
  const scanCurrent    = useScanStore(s => s.scanCurrent)
  const addCurrent     = useScanStore(s => s.addCurrent)
  const addTotal       = useScanStore(s => s.addTotal)
  const analyzeCurrent = useScanStore(s => s.analyzeCurrent)
  const analyzeTotal   = useScanStore(s => s.analyzeTotal)

  const t = useMappedTranslations({
    scanning:  'scan.step.scanning',
    deleting:  'scan.step.deleting',
    adding:    'scan.step.adding',
    analyzing: 'scan.step.analyzing',
    files:     'scan.unit.files',
  })

  // 総数が分かる段階だけ割合を出す。列挙中と削除中は総数が無いので流れるバーにする
  const [current, total] = processStep === 'adding'    ? [addCurrent, addTotal]
                         : processStep === 'analyzing' ? [analyzeCurrent, analyzeTotal]
                         : [0, 0]
  const ratio = total > 0 ? current / total : null

  const label = processStep ? t[processStep] : t.scanning
  const count = processStep === 'scanning' ? `${scanCurrent} ${t.files}`
              : total > 0                  ? `${current} / ${total}`
              : ''

  return (
    <div className={`sm-component-container${scanning ? ' active' : ''}`} aria-hidden={!scanning}>
      <div className="sm-component-track">
        <div
          className={`sm-component-fill${ratio === null ? ' indeterminate' : ''}`}
          style={ratio === null ? undefined : { width: `${ratio * 100}%` }}
        />
      </div>
      <div className="sm-component-tag" role="status">
        <span className="sm-component-label">{label}</span>
        {count && <span className="sm-component-count">{count}</span>}
      </div>
    </div>
  )
}
