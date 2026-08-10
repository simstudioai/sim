import { ChipSwitch, cn, Label } from '@sim/emcn'

const BOOLEAN_CONTROL_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const

type BooleanControlValue = (typeof BOOLEAN_CONTROL_OPTIONS)[number]['value']

interface BooleanControlProps {
  value: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Presents boolean workflow values through the canonical segmented chip control.
 * Value storage and workflow persistence remain the caller's responsibility.
 */
export function BooleanControl({
  value,
  onChange,
  label,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: BooleanControlProps) {
  const handleChange = (nextValue: BooleanControlValue) => {
    onChange(nextValue === 'on')
  }

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        label ? 'justify-between' : 'justify-start',
        className
      )}
    >
      {label ? (
        <Label className='min-w-0 font-normal text-[var(--text-body)] text-small'>{label}</Label>
      ) : null}
      <ChipSwitch<BooleanControlValue>
        options={BOOLEAN_CONTROL_OPTIONS}
        value={value ? 'on' : 'off'}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel ?? label ?? 'Boolean setting'}
      />
    </div>
  )
}
