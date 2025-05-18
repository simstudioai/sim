import { useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { useSubBlockValue } from '../hooks/use-sub-block-value'


interface SliderInputProps {
  min?: number
  max?: number
  defaultValue: number
  blockId: string
  subBlockId: string
  step?: number
  integer?: boolean
  isPreview?: boolean
  value?: number
}

export function SliderInput({
  min = 0,
  max = 100,
  defaultValue,
  blockId,
  subBlockId,
  step = 0.1,
  integer = false,
  isPreview = false,
  value: propValue
}: SliderInputProps) {
  const [value, setValue] = useSubBlockValue<number>(blockId, subBlockId, false, isPreview, propValue)

  // Clamp the value within bounds while preserving relative position when possible
  const normalizedValue = useMemo(() => {
    if (value === null) return defaultValue

    // If value exceeds max, scale it down proportionally
    if (value > max) {
      const prevMax = Math.max(max * 2, value) // Assume previous max was at least the current value
      const scaledValue = (value / prevMax) * max
      return integer ? Math.round(scaledValue) : scaledValue
    }

    // Otherwise just clamp it
    const clampedValue = Math.min(Math.max(value, min), max)
    return integer ? Math.round(clampedValue) : clampedValue
  }, [value, min, max, defaultValue, integer])

  // Update the value if it needs normalization
  useEffect(() => {
    if (value !== null && value !== normalizedValue) {
      setValue(normalizedValue)
    }
  }, [normalizedValue, value, setValue])

  return (
    <div className='relative pt-2 pb-6'>
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={integer ? 1 : step}
        onValueChange={(value) => setValue(integer ? Math.round(value[0]) : value[0])}
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
