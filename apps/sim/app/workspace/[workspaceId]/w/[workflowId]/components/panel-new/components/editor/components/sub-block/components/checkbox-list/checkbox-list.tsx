import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string }[]
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

interface CheckboxItemProps {
  blockId: string
  option: { label: string; id: string }
  isPreview: boolean
  subBlockValues?: Record<string, any>
  disabled: boolean
}

/**
 * Individual checkbox item component that calls useSubBlockValue hook at top level
 */
function CheckboxItem({ blockId, option, isPreview, subBlockValues, disabled }: CheckboxItemProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, option.id)

  // Get preview value for this specific option
  const previewValue = isPreview && subBlockValues ? subBlockValues[option.id]?.value : undefined

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  const handleChange = (checked: boolean) => {
    // Only update store when not in preview mode or disabled
    if (!isPreview && !disabled) {
      setStoreValue(checked)
    }
  }

  return (
    <div className='flex items-center space-x-2'>
      <Checkbox
        id={`${blockId}-${option.id}`}
        checked={Boolean(value)}
        onCheckedChange={handleChange}
        disabled={isPreview || disabled}
      />
      <Label
        htmlFor={`${blockId}-${option.id}`}
        className='cursor-pointer font-medium font-sans text-[var(--text-primary)] text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50'
      >
        {option.label}
      </Label>
    </div>
  )
}

export function CheckboxList({
  blockId,
  subBlockId,
  title,
  options,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: CheckboxListProps) {
  return (
    <div className='grid grid-cols-1 gap-4 pt-1'>
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
