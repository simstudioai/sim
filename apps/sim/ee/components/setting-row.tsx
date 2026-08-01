import { Info, Label } from '@sim/emcn'

interface SettingRowProps {
  label: string
  description?: string
  /** Optional supplementary guidance shown in a tooltip on an info icon beside the label. */
  labelTooltip?: string
  /** Marks the field as not required, rendered as a muted suffix on the label. */
  optional?: boolean
  /** Validation message rendered beneath the control. */
  error?: React.ReactNode
  /**
   * Id of the control this row labels. Wires the label to the control so
   * clicking it focuses the field, and points the control at the error text via
   * `aria-describedby` — pass the same id to the child input.
   */
  htmlFor?: string
  children: React.ReactNode
}

export function SettingRow({
  label,
  description,
  labelTooltip,
  optional = false,
  error,
  htmlFor,
  children,
}: SettingRowProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-1.5'>
        <Label htmlFor={htmlFor}>
          {label}
          {optional ? <span className='ml-1 text-[var(--text-muted)]'>(optional)</span> : null}
        </Label>
        {labelTooltip && (
          <Info side='bottom' align='start'>
            {labelTooltip}
          </Info>
        )}
      </div>
      {description && <p className='text-[var(--text-muted)] text-caption'>{description}</p>}
      {children}
      {error ? (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {error}
        </p>
      ) : null}
    </div>
  )
}
