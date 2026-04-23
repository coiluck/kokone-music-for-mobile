type IconMode = 'outline' | 'fill' | null;

interface IconProps {
  name: string;
  mode: IconMode;
  size?: number;
  color?: string;
  className?: string;
  folder?: string
}

export const Icon = ({ name, mode, size = 24, color = 'currentColor', className, folder }: IconProps) => {
  const src = mode
    ? `${folder}${name}-${mode}.svg`
    : `${folder}${name}.svg`;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        cursor: 'pointer'
      }}
    />
  );
};