import { useEffect } from 'react'
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
  step = 0.1,
  integer = false,
  isPreview = false,
  previewValue,
}: SliderInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<number>(blockId, subBlockId)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Clamp the value within bounds while preserving relative position when possible
  const normalizedValue =
    value !== null && value !== undefined ? Math.max(min, Math.min(max, value)) : defaultValue

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
    <div className='relative pt-2 pb-6'>
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={integer ? 1 : step}
        onValueChange={(value) => setStoreValue(integer ? Math.round(value[0]) : value[0])}
        disabled={isPreview}
        className='[&_[class*=SliderTrack]]:h-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4'
      />
      <div
        className='absolute text-muted-foreground text-sm'
        style={{
          left: `clamp(0%, ${((normalizedValue - min) / (max - min)) * 100}%, 100%)`,
          transform: `translateX(-${(() => {
            const percentage = ((normalizedValue - min) / (max - min)) * 100
            const bias = -25 * Math.sin((percentage * Math.PI) / 50)
            return percentage === 0 ? 0 : percentage === 100 ? 100 : 50 + bias
          })()}%)`,
          top: '24px',
        }}
      >
        {integer ? Math.round(normalizedValue).toString() : Number(normalizedValue).toFixed(1)}
      </div>
    </div>
  )
}
