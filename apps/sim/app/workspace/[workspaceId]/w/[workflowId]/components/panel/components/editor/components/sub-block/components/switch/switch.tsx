import { Label, Switch as UISwitch } from '@sim/emcn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface SwitchProps {
  blockId: string
  subBlockId: string
  title: string
  value?: boolean | string
  isPreview?: boolean
  previewValue?: boolean | string | null
  disabled?: boolean
}

export function Switch({
  blockId,
  subBlockId,
  title,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
}: SwitchProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<boolean | string>(blockId, subBlockId)

  const value = isPreview ? previewValue : (storeValue ?? propValue)

  const handleChange = (checked: boolean) => {
    if (!isPreview && !disabled) {
      setStoreValue(checked)
    }
  }

  return (
    <div className='flex items-center gap-x-3'>
      <UISwitch
        id={`${blockId}-${subBlockId}`}
        checked={value === true || value === 'true'}
        onCheckedChange={handleChange}
        disabled={isPreview || disabled}
      />
      <Label
        htmlFor={`${blockId}-${subBlockId}`}
        className='cursor-pointer font-sans text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50'
      >
        {title}
      </Label>
    </div>
  )
}
