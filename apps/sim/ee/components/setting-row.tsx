import { Label, Tooltip } from '@sim/emcn'
import { Info } from 'lucide-react'

interface SettingRowProps {
  label: string
  description?: string
  /** Optional supplementary guidance shown in a tooltip on an info icon beside the label. */
  labelTooltip?: string
  /** Marks the field as not required, rendered as a muted suffix on the label. */
  optional?: boolean
  /** Validation message rendered beneath the control. */
  error?: React.ReactNode
  children: React.ReactNode
}

export function SettingRow({
  label,
  description,
  labelTooltip,
  optional = false,
  error,
  children,
}: SettingRowProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-1.5'>
        <Label className='text-[var(--text-primary)] text-small'>
          {label}
          {optional ? <span className='ml-1 text-[var(--text-muted)]'>(optional)</span> : null}
        </Label>
        {labelTooltip && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Info className='size-[14px] cursor-default text-[var(--text-muted)]' />
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom' align='start'>
              {labelTooltip}
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
      {description && <p className='text-[var(--text-muted)] text-caption'>{description}</p>}
      {children}
      {error ? <p className='text-[var(--text-error)] text-caption'>{error}</p> : null}
    </div>
  )
}
