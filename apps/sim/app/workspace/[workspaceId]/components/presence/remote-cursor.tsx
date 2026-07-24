interface RemoteCursorProps {
  name: string
  color: string
}

/**
 * The shared collaborator cursor mark — a filled pointer plus a colored name tag.
 * Positioning is the caller's responsibility (the canvas applies the ReactFlow
 * viewport transform; the file browser applies the list scroll offset), so this
 * component is purely the visual and is identical across every surface.
 */
export function RemoteCursor({ name, color }: RemoteCursorProps) {
  return (
    <div className='relative flex items-start'>
      <svg
        className='-mt-4.5'
        width={24}
        height={24}
        viewBox='0 0 24 24'
        fill={color}
        aria-hidden='true'
      >
        <path d='M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z' />
      </svg>
      <div
        className='ml-[-4px] inline-flex max-w-[160px] truncate whitespace-nowrap rounded-xs px-1.5 py-0.5 font-medium text-[var(--surface-1)] text-xs'
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}
