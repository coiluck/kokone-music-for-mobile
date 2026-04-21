import { useScanStore } from '../lib/scanStore'
import '../../css/components/ScanMessage.css'

export function ScanMessage() {
  const scanning     = useScanStore(s => s.scanning)
  const processStep  = useScanStore(s => s.processStep)
  const scanCurrent  = useScanStore(s => s.scanCurrent)
  const addCurrent   = useScanStore(s => s.addCurrent)
  const addTotal     = useScanStore(s => s.addTotal)
  const currentFile  = useScanStore(s => s.currentFile)

  return (
    <div className={`sm-component-container${scanning ? ' active' : ''}`}>
      <div className="sm-component-icon"></div>
      <div className="sm-component-text">
        {processStep}
      </div>
    </div>
  )
}