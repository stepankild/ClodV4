import { STRAIN_COLORS } from '../RoomMap/PlantCell';

export default function VegMapCell({ batchLabel, strainLabel, batchIndex, isEmpty, isActive, onClick, compact, micro }) {
  const sizeClass = micro
    ? 'w-[18px] h-[18px] sm:w-[20px] sm:h-[20px]'
    : compact
      ? 'w-[32px] h-[24px] sm:w-[36px] sm:h-[28px]'
      : 'min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]';

  if (isEmpty) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`
          ${sizeClass}
          border border-dashed border-dark-600 rounded-[2px]
          flex items-center justify-center
          text-dark-600 text-[8px]
          hover:border-dark-500 hover:bg-dark-700/30 transition
          ${isActive ? 'ring-1 ring-primary-500 border-primary-500 bg-primary-500/10' : ''}
        `}
      />
    );
  }

  const color = STRAIN_COLORS[batchIndex % STRAIN_COLORS.length] || STRAIN_COLORS[0];

  // Short strain label for micro cells (max 3 chars)
  const shortLabel = strainLabel
    ? (strainLabel.length > 3 ? strainLabel.slice(0, 3) : strainLabel)
    : (batchLabel && batchLabel.length > 3 ? batchLabel.slice(0, 3) : batchLabel);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${batchLabel}${strainLabel && strainLabel !== batchLabel ? ` (${strainLabel})` : ''}`}
      className={`
        ${sizeClass}
        ${color.bg} border ${color.border} rounded-[2px]
        flex items-center justify-center
        transition cursor-pointer
        hover:brightness-125
        ${isActive ? 'ring-1 ring-white scale-105' : ''}
      `}
    >
      {micro ? (
        <span className={`text-[7px] sm:text-[8px] font-medium ${color.text} leading-none truncate select-none`}>
          {shortLabel}
        </span>
      ) : !compact ? (
        <span className={`text-[9px] font-medium ${color.text} leading-tight truncate max-w-[40px] select-none`}>
          {batchLabel && batchLabel.length > 6 ? batchLabel.slice(0, 6) : batchLabel}
        </span>
      ) : null}
    </button>
  );
}
