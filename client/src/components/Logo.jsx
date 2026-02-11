/**
 * True Source — логотип фермы.
 * Лист + корни = "True Source" (настоящий источник).
 */
export default function Logo({ size = 'md', showText = true }) {
  const sizes = {
    sm: { icon: 28, text: 'text-sm', gap: 'gap-2' },
    md: { icon: 32, text: 'text-lg', gap: 'gap-3' },
    lg: { icon: 48, text: 'text-2xl', gap: 'gap-3' },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={`flex items-center ${s.gap}`}>
      <div
        className="shrink-0"
        style={{ width: s.icon, height: s.icon }}
      >
        <svg
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          width="100%"
          height="100%"
        >
          {/* Круглый фон */}
          <circle cx="32" cy="32" r="30" fill="#0d3320" stroke="#22c55e" strokeWidth="2" />

          {/* Стебель */}
          <path
            d="M32 42 L32 26"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Левый лист */}
          <path
            d="M32 30 Q22 22 18 14 Q24 16 32 26"
            fill="#16a34a"
            stroke="#22c55e"
            strokeWidth="1"
          />

          {/* Правый лист */}
          <path
            d="M32 28 Q40 18 46 12 Q40 16 32 24"
            fill="#16a34a"
            stroke="#22c55e"
            strokeWidth="1"
          />

          {/* Центральный лист (верхний) */}
          <path
            d="M32 26 Q28 14 32 8 Q36 14 32 26"
            fill="#22c55e"
            stroke="#15803d"
            strokeWidth="0.8"
          />

          {/* Корни */}
          <path
            d="M32 42 Q28 48 24 54"
            stroke="#a3a3a3"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M32 42 Q32 50 32 56"
            stroke="#a3a3a3"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M32 42 Q36 48 40 54"
            stroke="#a3a3a3"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>
      </div>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className={`${s.text} font-bold text-white tracking-wide`}>
            TRUE SOURCE
          </span>
          <span className="text-[10px] text-green-500/70 tracking-[0.2em] uppercase mt-0.5">
            grow management
          </span>
        </div>
      )}
    </div>
  );
}
