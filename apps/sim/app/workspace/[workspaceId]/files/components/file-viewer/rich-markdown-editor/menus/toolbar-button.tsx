import { cn, Tooltip } from '@sim/emcn'
import type { LucideIcon } from 'lucide-react'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  isActive?: boolean
  onClick: () => void
}

/** A single icon button for the editor's floating toolbars (bubble menu, link hover card). */
export function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  isActive = false,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          aria-label={label}
          aria-pressed={isActive}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            'flex size-[28px] items-center justify-center rounded-md text-[var(--text-icon)] outline-none transition-colors focus-visible:bg-[var(--surface-hover)] [&_svg]:size-[14px]',
            isActive
              ? 'bg-[var(--surface-active)] text-[var(--text-body)]'
              : 'hover-hover:bg-[var(--surface-hover)]'
          )}
        >
          <Icon />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {shortcut ? <Tooltip.Shortcut keys={shortcut}>{label}</Tooltip.Shortcut> : label}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

/** Thin vertical separator between groups of {@link ToolbarButton}s. */
export function ToolbarDivider() {
  return <div className='mx-0.5 h-[18px] w-px bg-[var(--border-1)]' />
}
