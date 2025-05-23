import { useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { useSubBlockValue } from '../hooks/use-sub-block-value'


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
}

export function SliderInput({
  blockId,
  subBlockId,
  min = 0,
  max = 100,
  defaultValue = 50,
  step = 1,
  integer = false,
  isPreview = false,
  previewValue
}: SliderInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<number>(blockId, subBlockId)
  
  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Clamp the value within bounds while preserving relative position when possible
  const normalizedValue = value !== null && value !== undefined 
    ? Math.max(min, Math.min(max, value))
    : defaultValue

  const displayValue = normalizedValue ?? defaultValue

  // Ensure the normalized value is set if it differs from the current value
  useEffect(() => {
    if (!isPreview && value !== null && value !== undefined && value !== normalizedValue) {
      setStoreValue(normalizedValue)
    }
  }, [normalizedValue, value, setStoreValue, isPreview])

  const handleValueChange = (newValue: number[]) => {
    if (!isPreview) {
      const processedValue = integer ? Math.round(newValue[0]) : newValue[0]
      setStoreValue(processedValue)
    }
  }

  return (
    <div className="flex items-center space-x-4">
      <div className="flex-1">
        <Slider
          value={[displayValue]}
          min={min}
          max={max}
          step={integer ? 1 : step}
          onValueChange={handleValueChange}
          disabled={isPreview}
          className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[class*=SliderTrack]]:h-1"
        />
      </div>
      <div className="text-sm font-medium min-w-[3rem] text-right">
        {displayValue}
      </div>
    </div>
  )
}
