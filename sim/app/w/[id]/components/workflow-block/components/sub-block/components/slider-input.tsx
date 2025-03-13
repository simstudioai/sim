import { useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface SliderInputProps {
  min?: number
  max?: number
  defaultValue: number
  blockId: string
  subBlockId: string
}

export function SliderInput({
  min = 0,
  max = 100,
  defaultValue,
  blockId,
  subBlockId,
}: SliderInputProps) {
  const [value, setValue] = useSubBlockValue<number>(blockId, subBlockId)

  // Clamp the value within bounds while preserving relative position when possible
  const normalizedValue = useMemo(() => {
    if (value === null) return defaultValue

    // If value exceeds max, scale it down proportionally
    if (value > max) {
      const prevMax = Math.max(max * 2, value) // Assume previous max was at least the current value
      return (value / prevMax) * max
    }

    // Otherwise just clamp it
    return Math.min(Math.max(value, min), max)
  }, [value, min, max, defaultValue])

  // Update the value if it needs normalization
  useEffect(() => {
    if (value !== null && value !== normalizedValue) {
      setValue(normalizedValue)
    }
  }, [normalizedValue, value, setValue])

  return (
    <div className="relative pt-2 pb-6">
      <Slider
        value={[normalizedValue]}
        min={min}
        max={max}
        step={0.1}
        onValueChange={(value) => setValue(value[0])}
        className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[class*=SliderTrack]]:h-1"
      />
      <div
        className="absolute text-sm text-muted-foreground"
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
        {Number(normalizedValue).toFixed(1)}
      </div>
    </div>
  )
}
