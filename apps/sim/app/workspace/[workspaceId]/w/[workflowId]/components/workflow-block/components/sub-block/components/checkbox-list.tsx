import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string }[]
  layout?: 'full' | 'half'
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
}

export function CheckboxList({
  blockId,
  subBlockId,
  title,
  options,
  layout,
  isPreview = false,
  subBlockValues,
  disabled = false,
}: CheckboxListProps) {
  return (
    <div className={cn('grid gap-4', layout === 'half' ? 'grid-cols-2' : 'grid-cols-1', 'pt-1')}>
      {options.map((option) => {
        const [storeValue, setStoreValue] = useSubBlockValue(blockId, option.id)

        // Get preview value for this specific option
        const previewValue =
          isPreview && subBlockValues ? subBlockValues[option.id]?.value : undefined

        // Use preview value when in preview mode, otherwise use store value
        const value = isPreview ? previewValue : storeValue

        const handleChange = (checked: boolean) => {
          // Only update store when not in preview mode or disabled
          if (!isPreview && !disabled) {
            setStoreValue(checked)
          }
        }

        return (
          <div key={option.id} className='flex items-center space-x-2'>
            <Checkbox
              id={`${blockId}-${option.id}`}
              checked={Boolean(value)}
              onCheckedChange={handleChange}
              disabled={isPreview || disabled}
            />
            <Label
              htmlFor={`${blockId}-${option.id}`}
              className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
