import { useEffect } from 'react'
import { Slider } from '@/components/ui/slider'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'

interface SliderInputProps {
  blockId: string
  subBlockId: string
  min?: number
  max?: number
  defaultValue?: number
  step?: number
  integer?: boolean
  isPreview?: boolean
  previewValue?: number | null
  disabled?: boolean
}

export function SliderInput({
  blockId,
  subBlockId,
  min = 0,
  max = 100,
  defaultValue,
  step = 0.1,
  integer = false,
  isPreview = false,
  previewValue,
  disabled = false,
}: SliderInputProps) {
  // Smart default value: if no default provided, use midpoint or 0.7 for 0-1 ranges
  const computedDefaultValue = defaultValue ?? (max <= 1 ? 0.7 : (min + max) / 2)
  const [storeValue, setStoreValue] = useSubBlockValue<number>(blockId, subBlockId)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Clamp the value within bounds while preserving relative position when possible
  const normalizedValue =
    value !== null && value !== undefined
      ? Math.max(min, Math.min(max, value))
      : computedDefaultValue

  const displayValue = normalizedValue ?? computedDefaultValue

  // Ensure the normalized value is set if it differs from the current value
  useEffect(() => {
    if (!isPreview && value !== null && value !== undefined && value !== normalizedValue) {
      setStoreValue(normalizedValue)
    }
  }, [normalizedValue, value, setStoreValue, isPreview])

  const handleValueChange = (newValue: number[]) => {
    if (!isPreview && !disabled) {
      const processedValue = integer ? Math.round(newValue[0]) : newValue[0]
      setStoreValue(processedValue)
    }
  }

  const percentage = ((normalizedValue - min) / (max - min)) * 100

  return (
    <div className='relative pt-2 pb-[22px]'>
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={integer ? 1 : step}
        onValueChange={handleValueChange}
        disabled={isPreview || disabled}
        className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[role=slider]]:cursor-pointer'
      />
      <div
        className='absolute top-6 text-muted-foreground text-sm'
        style={{
          left: `${percentage}%`,
          transform: `translateX(-${percentage}%)`,
        }}
      >
        {integer ? Math.round(normalizedValue).toString() : Number(normalizedValue).toFixed(1)}
      </div>
    </div>
  )
}
