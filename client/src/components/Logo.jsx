/**
 * True Source — логотип.
 * variant="login"  — огромный лист + текст (для страницы входа, вне карточки)
 * default          — горизонтально: лист + текст + "grow management" (сайдбар)
 */
import leafSvg from '../assets/true-source-leaf.svg';
import textSvg from '../assets/true-source-text.svg';

export default function Logo({ size = 'md', showText = true, variant }) {
  if (variant === 'login') {
    return (
      <div className="flex flex-col items-center gap-5">
        <img
          src={leafSvg}
          alt="True Source"
          className="w-72 h-72 drop-shadow-[0_0_60px_rgba(74,222,128,0.35)]"
        />
        <img
          src={textSvg}
          alt="True Source"
          className="w-64 drop-shadow-[0_0_20px_rgba(74,222,128,0.25)]"
        />
        <span className="text-xs tracking-[0.3em] uppercase font-medium text-green-400/50 -mt-2">
          grow management
        </span>
      </div>
    );
  }

  const sizes = {
    sm: { icon: 36, textW: 100 },
    md: { icon: 44, textW: 130 },
    lg: { icon: 56, textW: 160 },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-3">
      <img
        src={leafSvg}
        alt=""
        className="shrink-0 drop-shadow-[0_0_12px_rgba(74,222,128,0.3)]"
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
            style={{ fontSize: size === 'sm' ? 7 : size === 'lg' ? 11 : 9 }}
          >
            grow management
          </span>
        </div>
      )}
    </div>
  );
}
