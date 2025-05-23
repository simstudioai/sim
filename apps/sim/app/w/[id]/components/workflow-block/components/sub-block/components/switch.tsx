import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch as UISwitch } from '@/components/ui/switch'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface SwitchProps {
  blockId: string
  subBlockId: string
  title: string
  value?: boolean
  isPreview?: boolean
  previewValue?: boolean | null
}

export function Switch({ 
  blockId, 
  subBlockId, 
  title, 
  value: propValue,
  isPreview = false,
  previewValue
}: SwitchProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<boolean>(blockId, subBlockId)

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : (propValue !== undefined ? propValue : storeValue)

  const handleChange = (checked: boolean) => {
    // Only update store when not in preview mode
    if (!isPreview) {
      setStoreValue(checked)
    }
  }

  return (
    <div className="flex items-center space-x-3">
      <UISwitch 
        id={`${blockId}-${subBlockId}`}
        checked={Boolean(value)}
        onCheckedChange={handleChange}
        disabled={isPreview}
      />
      <Label 
        htmlFor={`${blockId}-${subBlockId}`}
        className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
      >
        {title}
      </Label>
    </div>
  )
}
