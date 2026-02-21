/**
 * True Source — логотип с новым дизайном.
 * SVG-файлы из assets: leaf (иконка) и text (название TRUE SOURCE).
 *
 * variant="login"  — вертикально: большой лист + текст снизу (для страницы входа)
 * default           — горизонтально: лист + текст + "grow management" (для сайдбара)
 */
import leafSvg from '../assets/true-source-leaf.svg';
import textSvg from '../assets/true-source-text.svg';

export default function Logo({ size = 'md', showText = true, variant }) {
  // Login page — большой вертикальный логотип
  if (variant === 'login') {
    return (
      <div className="flex flex-col items-center gap-4">
        <img
          src={leafSvg}
          alt="True Source"
          className="w-36 h-36 drop-shadow-[0_0_30px_rgba(74,222,128,0.3)]"
        />
        <img
          src={textSvg}
          alt="True Source"
          className="w-48 drop-shadow-[0_0_16px_rgba(74,222,128,0.2)]"
        />
        <span className="text-[11px] tracking-[0.25em] uppercase font-medium text-green-400/50 -mt-2">
          grow management
        </span>
      </div>
    );
  }

  // Sidebar — горизонтально: лист + текст + subtitle
  const sizes = {
    sm: { icon: 30, textW: 90 },
    md: { icon: 36, textW: 110 },
    lg: { icon: 48, textW: 140 },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-2.5">
      <img
        src={leafSvg}
        alt=""
        className="shrink-0 drop-shadow-[0_0_10px_rgba(74,222,128,0.25)]"
        style={{ width: s.icon, height: s.icon }}
      />
      {showText && (
        <div className="flex flex-col gap-0.5">
          <img
            src={textSvg}
            alt="True Source"
            className="drop-shadow-[0_0_8px_rgba(74,222,128,0.15)]"
            style={{ width: s.textW }}
          />
          <span
            className="tracking-[0.2em] uppercase font-medium text-green-400/45"
            style={{ fontSize: size === 'sm' ? 7 : size === 'lg' ? 10 : 8 }}
          >
            grow management
          </span>
        </div>
      )}
    </div>
  );
}
