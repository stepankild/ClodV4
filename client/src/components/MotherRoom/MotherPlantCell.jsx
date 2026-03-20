const HEALTH_COLORS = {
  excellent:     { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  good:          { bg: 'bg-green-500/20',   border: 'border-green-500',   text: 'text-green-400',   dot: 'bg-green-500' },
  satisfactory:  { bg: 'bg-yellow-500/20',  border: 'border-yellow-500',  text: 'text-yellow-400',  dot: 'bg-yellow-500' },
  poor:          { bg: 'bg-orange-500/20',   border: 'border-orange-500',  text: 'text-orange-400',  dot: 'bg-orange-500' },
  critical:      { bg: 'bg-red-500/20',      border: 'border-red-500',     text: 'text-red-400',     dot: 'bg-red-500' },
};

export { HEALTH_COLORS };

export default function MotherPlantCell({ plantName, strainLabel, health, isEmpty, isActive, onClick, micro }) {
  const sizeClass = micro
    ? 'w-[18px] h-[18px] sm:w-[20px] sm:h-[20px]'
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

  const color = HEALTH_COLORS[health] || HEALTH_COLORS.good;
  const shortLabel = plantName
    ? (plantName.length > 3 ? plantName.slice(0, 3) : plantName)
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${plantName || ''}${strainLabel ? ` (${strainLabel})` : ''}`}
      className={`
        ${sizeClass}
        ${color.bg} border ${color.border} rounded-[2px]
        flex items-center justify-center
        transition cursor-pointer
        hover:brightness-125
        ${isActive ? 'ring-1 ring-white scale-105' : ''}
      `}
    >
      <span className={`text-[7px] sm:text-[8px] font-medium ${color.text} leading-none truncate select-none`}>
        {shortLabel}
      </span>
    </button>
  );
}
