const STRAIN_COLORS = [
  { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-400', dot: 'bg-emerald-500', hex: '#10b981', hexBg: '#10b98133' },
  { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400', dot: 'bg-purple-500', hex: '#a855f7', hexBg: '#a855f733' },
  { bg: 'bg-amber-500/20', border: 'border-amber-500', text: 'text-amber-400', dot: 'bg-amber-500', hex: '#f59e0b', hexBg: '#f59e0b33' },
  { bg: 'bg-cyan-500/20', border: 'border-cyan-500', text: 'text-cyan-400', dot: 'bg-cyan-500', hex: '#06b6d4', hexBg: '#06b6d433' },
  { bg: 'bg-rose-500/20', border: 'border-rose-500', text: 'text-rose-400', dot: 'bg-rose-500', hex: '#f43f5e', hexBg: '#f43f5e33' },
  { bg: 'bg-lime-500/20', border: 'border-lime-500', text: 'text-lime-400', dot: 'bg-lime-500', hex: '#84cc16', hexBg: '#84cc1633' },
  { bg: 'bg-indigo-500/20', border: 'border-indigo-500', text: 'text-indigo-400', dot: 'bg-indigo-500', hex: '#6366f1', hexBg: '#6366f133' },
  { bg: 'bg-orange-500/20', border: 'border-orange-500', text: 'text-orange-400', dot: 'bg-orange-500', hex: '#f97316', hexBg: '#f9731633' },
  { bg: 'bg-teal-500/20', border: 'border-teal-500', text: 'text-teal-400', dot: 'bg-teal-500', hex: '#14b8a6', hexBg: '#14b8a633' },
  { bg: 'bg-pink-500/20', border: 'border-pink-500', text: 'text-pink-400', dot: 'bg-pink-500', hex: '#ec4899', hexBg: '#ec489933' },
];

export { STRAIN_COLORS };

export default function PlantCell({ plantNumber, strainIndex, strainName, isEmpty, isSelected, onClick, compact }) {
  if (isEmpty) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`
          min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]
          border border-dashed border-dark-600 rounded-md
          flex items-center justify-center
          text-dark-600 text-[9px]
          hover:border-dark-500 hover:bg-dark-700/30 transition
          ${isSelected ? 'ring-2 ring-primary-500 border-primary-500' : ''}
        `}
      >
        <span className="text-dark-600 select-none">—</span>
      </button>
    );
  }

  const color = STRAIN_COLORS[strainIndex % STRAIN_COLORS.length] || STRAIN_COLORS[0];

  return (
    <button
      type="button"
      onClick={onClick}
      title={`#${plantNumber} — ${strainName || '?'}`}
      className={`
        min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]
        ${color.bg} border ${color.border} rounded-md
        flex flex-col items-center justify-center gap-0
        transition cursor-pointer
        hover:brightness-125
        ${isSelected ? 'ring-2 ring-white scale-105' : ''}
      `}
    >
      <span className={`text-xs font-bold ${color.text} leading-tight`}>
        {plantNumber}
      </span>
      {!compact && strainName && (
        <span className="text-[8px] text-dark-400 leading-tight truncate max-w-[40px]">
          {strainName.length > 5 ? strainName.slice(0, 5) : strainName}
        </span>
      )}
    </button>
  );
}
