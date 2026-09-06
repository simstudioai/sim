'use client'

import { type ComponentType, useId } from 'react'
import { cn } from '../../lib/cn'
import { Tooltip } from '../tooltip/tooltip'

export interface IconSwitchOption<T extends string = string> {
  value: T
  label: string
  icon: ComponentType<{ className?: string }>
}

export interface IconSwitchProps<T extends string = string> {
  options: readonly [IconSwitchOption<T>, IconSwitchOption<T>]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  showTooltips?: boolean
  'aria-label': string
  className?: string
}

/**
 * Two square icon choices inside a compact frame. Native radios provide mutually
 * exclusive selection and keyboard navigation; optional tooltips use each label.
 *
 * @example
 * <IconSwitch options={modes} value={mode} onValueChange={setMode} aria-label="Input mode" />
 */
export function IconSwitch<T extends string>({
  options,
  value,
  onValueChange,
  disabled = false,
  showTooltips = false,
  'aria-label': ariaLabel,
  className,
}: IconSwitchProps<T>) {
  const groupName = useId()

  return (
    <div
      role='radiogroup'
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm border border-[var(--border)] bg-[var(--surface-2)]',
        disabled && 'opacity-50',
        className
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        const optionId = `${groupName}-${option.value}`
        const input = (
          <input
            id={optionId}
            type='radio'
            name={groupName}
            value={option.value}
            checked={selected}
            onChange={() => onValueChange(option.value)}
            disabled={disabled}
            aria-label={option.label}
            className='peer m-0 size-[18px] cursor-pointer appearance-none rounded-[inherit] bg-transparent transition-colors checked:bg-[var(--surface-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-icon)] disabled:cursor-not-allowed'
          />
        )

        return (
          <label
            key={option.value}
            htmlFor={optionId}
            className={cn(
              'relative flex first:rounded-l-[calc(theme(borderRadius.sm)-var(--border-width,1px))] last:rounded-r-[calc(theme(borderRadius.sm)-var(--border-width,1px))]',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
            )}
          >
            {showTooltips ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>{input}</Tooltip.Trigger>
                <Tooltip.Content side='top'>{option.label}</Tooltip.Content>
              </Tooltip.Root>
            ) : (
              input
            )}
            <Icon
              aria-hidden='true'
              className={cn(
                '-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 size-[12px] transition-colors',
                selected
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] peer-hover:text-[var(--text-secondary)]'
              )}
            />
          </label>
        )
      })}
    </div>
  )
}
