import { ChipSelect } from '@sim/emcn'
import { type BenchmarkModelConfig, benchmarkModelConfigSchema } from '@/lib/benchmarks/models'
import { MOTHERSHIP_EFFORT_OPTIONS, MOTHERSHIP_MODEL_OPTIONS } from '@/lib/mothership/model-options'

interface BenchmarkModelPickerProps {
  label: string
  value: BenchmarkModelConfig
  disabled: boolean
  onChange: (value: BenchmarkModelConfig) => void
}

export function BenchmarkModelPicker({
  label,
  value,
  disabled,
  onChange,
}: BenchmarkModelPickerProps) {
  return (
    <div className='flex flex-col gap-2'>
      <p className='text-[var(--text-body)] text-small'>{label}</p>
      <div className='flex flex-wrap gap-2'>
        <ChipSelect
          aria-label={`${label} model`}
          options={MOTHERSHIP_MODEL_OPTIONS}
          value={value.modelSelection.model}
          disabled={disabled}
          onChange={(model) =>
            onChange(
              benchmarkModelConfigSchema.parse({
                ...value,
                modelSelection: { model, fastMode: false },
              })
            )
          }
        />
        <ChipSelect
          aria-label={`${label} effort`}
          options={MOTHERSHIP_EFFORT_OPTIONS}
          value={value.effort}
          disabled={disabled}
          onChange={(effort) => onChange(benchmarkModelConfigSchema.parse({ ...value, effort }))}
        />
      </div>
    </div>
  )
}
