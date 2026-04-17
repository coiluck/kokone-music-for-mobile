type IconMode = 'outline' | 'fill';

interface IconProps {
  name: string;
  mode: IconMode;
  size?: number;
  color?: string;
  className?: string;
  folder?: string
}

export const Icon = ({ name, mode, size = 24, color = 'currentColor', className, folder }: IconProps) => {
  const src = `${folder}${name}-${mode}.svg`;

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
      }}
    />
  );
};