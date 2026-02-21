/**
 * True Source — логотип с новым дизайном.
 * Использует SVG-файлы из assets: leaf (иконка) и text (название).
 *
 * variant="sidebar"  — горизонтально: лист + текст + "grow management"
 * variant="login"    — вертикально: большой лист + текст снизу
 *
 * Старые пропсы (size, showText) остаются для обратной совместимости.
 */
import leafSvg from '../assets/true-source-leaf.svg';
import textSvg from '../assets/true-source-text.svg';

export default function Logo({ size = 'md', showText = true, variant }) {
  // Login page — большой вертикальный логотип
  if (variant === 'login') {
    return (
      <div className="flex flex-col items-center gap-5">
        <img src={leafSvg} alt="True Source" className="w-32 h-32 drop-shadow-[0_0_24px_rgba(74,222,128,0.25)]" />
        <img src={textSvg} alt="True Source" className="h-10 drop-shadow-[0_0_12px_rgba(74,222,128,0.15)]" />
      </div>
    );
  }

  // Sidebar / header — горизонтально: лист + текст + subtitle
  const sizes = {
    sm: { icon: 28, textH: 10 },
    md: { icon: 32, textH: 12 },
    lg: { icon: 48, textH: 16 },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-2.5">
      <img
        src={leafSvg}
        alt="True Source"
        className="shrink-0 drop-shadow-[0_0_8px_rgba(74,222,128,0.2)]"
        style={{ width: s.icon, height: s.icon }}
      />
      {showText && (
        <div className="flex flex-col leading-none gap-0.5">
          <img
            src={textSvg}
            alt="True Source"
            className="drop-shadow-[0_0_6px_rgba(74,222,128,0.12)]"
            style={{ height: s.textH }}
          />
          <span
            className="tracking-[0.18em] uppercase font-medium"
            style={{
              fontSize: s.textH * 0.38,
              color: 'rgba(74, 222, 128, 0.55)',
              marginLeft: 1,
            }}
          >
            grow management
          </span>
        </div>
      )}
    </div>
  );
}
