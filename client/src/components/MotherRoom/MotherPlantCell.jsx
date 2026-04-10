const HEALTH_COLORS = {
  excellent:     { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  good:          { bg: 'bg-green-500/20',   border: 'border-green-500',   text: 'text-green-400',   dot: 'bg-green-500' },
  satisfactory:  { bg: 'bg-yellow-500/20',  border: 'border-yellow-500',  text: 'text-yellow-400',  dot: 'bg-yellow-500' },
  poor:          { bg: 'bg-orange-500/20',  border: 'border-orange-500',  text: 'text-orange-400',  dot: 'bg-orange-500' },
  critical:      { bg: 'bg-red-500/20',     border: 'border-red-500',     text: 'text-red-400',     dot: 'bg-red-500' },
};

export { HEALTH_COLORS };

export default function MotherPlantCell({
  plantName,
  strainLabel,
  health,
  isEmpty,
  isActive,
  isDragging,
  isDropTarget,
  onClick,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  micro,
}) {
  const sizeClass = micro
    ? 'w-[22px] h-[22px] sm:w-[26px] sm:h-[26px]'
    : 'min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]';

  const commonHandlers = {
    onClick,
    onDragOver,
    onDragLeave,
    onDrop,
    role: 'button',
    tabIndex: 0,
  };

  if (isEmpty) {
    return (
      <div
        {...commonHandlers}
        className={`
          ${sizeClass}
          border border-dashed rounded-[3px]
          flex items-center justify-center
          text-dark-600 text-[9px] select-none
          transition cursor-pointer
          ${isDropTarget
            ? 'border-primary-400 bg-primary-500/20 ring-1 ring-primary-400'
            : 'border-dark-600 hover:border-dark-500 hover:bg-dark-700/30'}
          ${isActive ? 'ring-1 ring-primary-500 border-primary-500 bg-primary-500/10' : ''}
        `}
      >
        <span className="opacity-0 group-hover:opacity-60 transition">+</span>
      </div>
    );
  }

  const color = HEALTH_COLORS[health] || HEALTH_COLORS.good;
  const shortLabel = plantName
    ? (plantName.length > 3 ? plantName.slice(0, 3) : plantName)
    : '';

  return (
    <div
      {...commonHandlers}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={`${plantName || ''}${strainLabel ? ` (${strainLabel})` : ''}`}
      className={`
        ${sizeClass}
        ${color.bg} border ${color.border} rounded-[3px]
        flex items-center justify-center
        transition select-none
        ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        hover:brightness-125
        ${isDragging ? 'opacity-40' : ''}
        ${isDropTarget ? 'ring-2 ring-primary-400' : ''}
        ${isActive ? 'ring-1 ring-white scale-105' : ''}
      `}
    >
      <span className={`text-[8px] sm:text-[9px] font-bold ${color.text} leading-none truncate`}>
        {shortLabel}
      </span>
    </div>
  );
}
