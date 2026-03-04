import { STRAIN_COLORS } from '../RoomMap/PlantCell';

export default function VegMapCell({ batchLabel, batchIndex, isEmpty, isActive, onClick }) {
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
          ${isActive ? 'ring-2 ring-primary-500 border-primary-500 bg-primary-500/10' : ''}
        `}
      >
        <span className="text-dark-600 select-none">—</span>
      </button>
    );
  }

  const color = STRAIN_COLORS[batchIndex % STRAIN_COLORS.length] || STRAIN_COLORS[0];

  return (
    <button
      type="button"
      onClick={onClick}
      title={batchLabel}
      className={`
        min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]
        ${color.bg} border ${color.border} rounded-md
        flex items-center justify-center
        transition cursor-pointer
        hover:brightness-125
        ${isActive ? 'ring-2 ring-white scale-105' : ''}
      `}
    >
      <span className={`text-[9px] font-medium ${color.text} leading-tight truncate max-w-[40px] select-none`}>
        {batchLabel && batchLabel.length > 6 ? batchLabel.slice(0, 6) : batchLabel}
      </span>
    </button>
  );
}
