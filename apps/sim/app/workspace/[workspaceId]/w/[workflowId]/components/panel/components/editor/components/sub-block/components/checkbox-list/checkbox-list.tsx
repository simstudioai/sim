import { Info } from 'lucide-react'
import { Checkbox, Label, Tooltip } from '@/components/emcn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface CheckboxListOption {
  label: string
  id: string
  defaultChecked?: boolean
  description?: string
}

interface CheckboxListProps {
  blockId: string
  options: CheckboxListOption[]
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

interface CheckboxItemProps {
  blockId: string
  option: CheckboxListOption
  isPreview: boolean
  subBlockValues?: Record<string, any>
  disabled: boolean
}

/**
 * Individual checkbox item component that calls useSubBlockValue hook at top level.
 *
 * @remarks
 * A `null` store value means the user has never toggled the checkbox, in which
 * case we fall back to `option.defaultChecked` for the displayed state. Any
 * explicit boolean (including `false`) takes precedence over the default.
 */
function CheckboxItem({ blockId, option, isPreview, subBlockValues, disabled }: CheckboxItemProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<boolean>(blockId, option.id)

  const previewValue = isPreview && subBlockValues ? subBlockValues[option.id]?.value : undefined
  const rawValue = isPreview ? previewValue : storeValue
  const effectiveValue = rawValue ?? option.defaultChecked ?? false

  const handleChange = (checked: boolean) => {
    if (!isPreview && !disabled) {
      setStoreValue(checked)
    }
  }

  return (
    <div className='flex items-center gap-2'>
      <Checkbox
        id={`${blockId}-${option.id}`}
        checked={Boolean(effectiveValue)}
        onCheckedChange={handleChange}
        disabled={isPreview || disabled}
      />
      <Label
        htmlFor={`${blockId}-${option.id}`}
        className='cursor-pointer font-medium font-sans text-[var(--text-primary)] text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50'
      >
        {option.label}
      </Label>
      {option.description && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Info className='h-[14px] w-[14px] cursor-default text-[var(--text-muted)]' />
          </Tooltip.Trigger>
          <Tooltip.Content side='top' align='start' className='max-w-xs'>
            <p>{option.description}</p>
          </Tooltip.Content>
        </Tooltip.Root>
      )}
    </div>
  )
}

export function CheckboxList({
  blockId,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: CheckboxListProps) {
  return (
    <div className='flex flex-col gap-y-2.5 pt-1'>
      {options.map((option) => (
        <CheckboxItem
          key={option.id}
          blockId={blockId}
          option={option}
          isPreview={isPreview}
          subBlockValues={subBlockValues}
          disabled={disabled}
        />
      ))}
    </div>
  )
}
