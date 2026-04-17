// ColorPicker.tsx
import { useState, useRef, useEffect } from 'react';
import { BlockPicker, SliderPicker } from 'react-color';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label: string;
  presetColors: string[]
}

export const ColorPicker = ({ color, onChange, label, presetColors }: Props) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (c: { hex: string }) => onChange(c.hex);

  return (
    <div ref={wrapperRef} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
      {label && <span>{label}</span>}

      <div style={{ position: 'relative' }}>
        <div
          onClick={() => setOpen(v => !v)}
          style={{
            width: '1.5rem', height: '1.5rem',
            borderRadius: '50%',
            background: color,
            border: '2px solid rgb(from var(--color-text) r g b / 0.25)',
            cursor: 'pointer',
          }}
        />

{open && (
  <div style={{ position: 'absolute', top: 36, right: 0, zIndex: 100 }}>
    <BlockPicker
      color={color}
      colors={presetColors}
      onChange={handleChange}
      triangle="hide"
      styles={{
        default: {
          card: { borderRadius: '10px 10px 0 0', boxShadow: 'none' },
        }
      }}
    />
    <SliderPicker
      color={color}
      onChange={handleChange}
      styles={{
        default: {
          wrap: {
            padding: '0 12px',
            paddingBottom: '14px',
            background: '#fff',
            borderRadius: '0 0 10px 10px',
          },
        } as any // wrapの型定義がないみたい
      }}
    />
  </div>
)}
      </div>
    </div>
  );
};