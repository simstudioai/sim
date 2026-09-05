import type { ComponentType, SVGProps } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'

interface ToolbarButtonProps {
  /** Any SVG icon component, e.g. from `@sim/emcn/icons`. */
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Reduces optically dense filled glyphs while keeping the standard button hit target. */
  iconSize?: 'default' | 'compact'
  label: string
  shortcut?: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
}

/** A single icon button for the editor's floating toolbars (bubble menu, link hover card). */
export function ToolbarButton({
  icon: Icon,
  iconSize = 'default',
  label,
  shortcut,
  isActive,
  disabled,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type='button'
          variant={isActive ? 'active' : 'ghost'}
          size='icon'
          aria-label={label}
          aria-pressed={isActive}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            'size-[28px] focus-visible:bg-[var(--surface-hover)]',
            !isActive && 'hover-hover:bg-[var(--surface-hover)]'
          )}
        >
          <Icon className={iconSize === 'compact' ? 'size-[12px]' : 'size-[14px]'} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {shortcut ? <Tooltip.Shortcut keys={shortcut}>{label}</Tooltip.Shortcut> : label}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

/** Thin vertical separator between groups of {@link ToolbarButton}s. */
export function ToolbarDivider() {
  return <div className='mx-0.5 h-[18px] w-px bg-[var(--border)]' />
}
