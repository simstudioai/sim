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
  const sliderValue = value ?? defaultValue

  return (
    <div className="relative pt-2 pb-6">
      <Slider
        value={[sliderValue]}
        min={min}
        max={max}
        step={0.1}
        onValueChange={(value) => setValue(value[0])}
        className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[class*=SliderTrack]]:h-1"
      />
      <div
        className="absolute text-sm text-muted-foreground"
        style={{
          left: `clamp(0%, ${((Number(sliderValue) - min) / (max - min)) * 100}%, 100%)`,
          transform: `translateX(-${(() => {
            const percentage = ((Number(sliderValue) - min) / (max - min)) * 100
            const bias = -25 * Math.sin((percentage * Math.PI) / 50)
            return percentage === 0 ? 0 : percentage === 100 ? 100 : 50 + bias
          })()}%)`,
          top: '24px',
        }}
      >
        {Number(sliderValue).toFixed(1)}
      </div>
    </div>
  )
}
