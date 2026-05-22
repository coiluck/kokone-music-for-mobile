import { useState, useRef, useEffect } from 'react'
import '../../css/components/Select.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

export default function Select<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: Props<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleSelect = (v: T) => {
    onChange(v)
    setIsOpen(false)
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  return (
    <div
      ref={containerRef}
      className={`select-component-container${disabled ? ' disabled' : ''}`}
    >
      <div
        className="select-component-trigger"
        onClick={() => {
          if (!disabled) setIsOpen(v => !v)
        }}
      >
        <div className="select-component-trigger-text">
          {selectedLabel}
        </div>
        <div className="select-component-trigger-icon-container">
          <div className="select-component-trigger-icon" />
        </div>
      </div>
      {isOpen && (
        <div className="select-component-option-container">
          {options.map(option => (
            <div
              key={option.value}
              className={`select-component-option${option.value === value ? ' selected' : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}