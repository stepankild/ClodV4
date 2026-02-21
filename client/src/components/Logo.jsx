/**
 * True Source — логотип.
 * variant="login"  — огромный лист + пиксельный текст (страница входа)
 * default          — лист-иконка + обычный текст + subtitle (сайдбар/хедер)
 */
import leafSvg from '../assets/true-source-leaf.svg';
import textSvg from '../assets/true-source-text.svg';

export default function Logo({ size = 'md', showText = true, variant }) {
  // ─── Login: гигантский лист + пиксельный SVG-текст ───
  if (variant === 'login') {
    return (
      <div className="flex flex-col items-center gap-2">
        <img
          src={leafSvg}
          alt="True Source"
          className="w-[22rem] h-[22rem] drop-shadow-[0_0_80px_rgba(74,222,128,0.3)]"
        />
        <img
          src={textSvg}
          alt="True Source"
          className="w-72 drop-shadow-[0_0_20px_rgba(74,222,128,0.25)]"
        />
        <span className="text-xs tracking-[0.3em] uppercase font-medium text-green-400/50 -mt-1">
          grow management
        </span>
      </div>
    );
  }

  // ─── Sidebar/Header: лист + обычный текст ───
  const sizes = {
    sm: { icon: 36, title: 'text-base', sub: 'text-[7px]' },
    md: { icon: 48, title: 'text-lg', sub: 'text-[8px]' },
    lg: { icon: 56, title: 'text-xl', sub: 'text-[9px]' },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-3">
      <img
        src={leafSvg}
        alt=""
        className="shrink-0 drop-shadow-[0_0_14px_rgba(74,222,128,0.3)]"
        style={{ width: s.icon, height: s.icon }}
      />
      {showText && (
        <div className="flex flex-col">
          <span className={`${s.title} font-bold text-white tracking-wide leading-tight`}>
            TRUE SOURCE
          </span>
          <span className={`${s.sub} tracking-[0.2em] uppercase font-medium text-green-400/50 mt-0.5`}>
            grow management
          </span>
        </div>
      )}
    </div>
  );
}
