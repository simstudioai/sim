'use client'

import { Chip, Tooltip } from '@sim/emcn'
import { Zap } from '@sim/emcn/icons'

interface FastModeToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
}

/** Shared lightning control for each chat mode's own Fast preference. */
export function FastModeToggle({
  enabled,
  onChange,
  disabled,
  label = 'Fast mode',
  description,
}: FastModeToggleProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Chip
          shape='round'
          aria-label={label}
          aria-pressed={enabled}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          leftAdornment={
            <Zap
              className='size-[14px] text-[var(--text-icon)]'
              fill={enabled ? 'currentColor' : 'none'}
            />
          }
        />
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>
        {description ?? (enabled ? 'Turn off Fast mode' : 'Turn on Fast mode')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
