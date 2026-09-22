import type { ButtonHTMLAttributes } from 'react'
import { cn, Tooltip } from '@sim/emcn'
import { ArrowLeftRight } from '@sim/emcn/icons'

interface FieldModeToggleProps {
  label: string
  active: boolean
  disabled?: boolean
  onClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
}

/** Shared field-mode affordance; the caller owns the mode and its stored values. */
export function FieldModeToggle({ label, active, disabled, onClick }: FieldModeToggleProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          className='flex size-[12px] shrink-0 items-center justify-center bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50'
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          <ArrowLeftRight
            className={cn(
              'size-[12px]! transition-colors',
              active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
            )}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>
        <p>{label}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
