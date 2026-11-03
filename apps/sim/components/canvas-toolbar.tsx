import type { ComponentType, MouseEventHandler, ReactNode } from 'react'
import { Button, chipHoverSurfaceClass, cn, Tooltip } from '@sim/emcn'
import { SelectAll } from '@sim/emcn/icons'

interface CanvasToolbarButtonProps {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  shortcut?: string
  disabled?: boolean
}

export function CanvasToolbarButton({
  label,
  icon: Icon,
  shortcut,
  disabled,
  onClick,
}: CanvasToolbarButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          aria-label={label}
          variant='ghost'
          size='icon'
          className={cn('pointer-coarse:size-11 size-7 rounded-sm p-0', chipHoverSurfaceClass)}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className='size-[14px]' />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>
        {shortcut ? <Tooltip.Shortcut keys={shortcut}>{label}</Tooltip.Shortcut> : label}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

interface CanvasToolbarProps {
  children: ReactNode
  fitLabel: string
  fitShortcut?: string
  onFit: () => void
  onContextMenu?: MouseEventHandler<HTMLDivElement>
}

export function CanvasToolbar({
  children,
  fitLabel,
  fitShortcut,
  onFit,
  onContextMenu,
}: CanvasToolbarProps) {
  return (
    <div
      role='group'
      aria-label='Canvas controls'
      className='absolute bottom-3 left-3 z-10 flex h-9 pointer-coarse:h-auto items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1'
      onContextMenu={onContextMenu}
    >
      {children}
      <div aria-hidden className='mx-1 h-5 w-px bg-[var(--border)]' />
      <CanvasToolbarButton
        label={fitLabel}
        icon={SelectAll}
        shortcut={fitShortcut}
        onClick={onFit}
      />
    </div>
  )
}
