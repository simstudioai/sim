import { z } from 'zod'
import { ModelSelectionSchema } from '@/lib/mothership/generated/protocol'
import { MOTHERSHIP_EFFORT_OPTIONS, MOTHERSHIP_MODEL_OPTIONS } from '@/lib/mothership/model-options'

export const benchmarkModelConfigSchema = z
  .object({
    modelSelection: ModelSelectionSchema,
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  })
  .strict()
export type BenchmarkModelConfig = z.infer<typeof benchmarkModelConfigSchema>

export const DEFAULT_BENCHMARK_PLANNER: BenchmarkModelConfig = {
  modelSelection: { model: 'claude-opus-5-5', fastMode: false },
  effort: 'medium',
}
export const DEFAULT_BENCHMARK_EVALUATOR: BenchmarkModelConfig = {
  modelSelection: { model: 'gpt-6-astra', fastMode: false },
  effort: 'high',
}

export function benchmarkModelLabel(config?: BenchmarkModelConfig): string {
  if (!config) return 'Model not recorded'
  const model = MOTHERSHIP_MODEL_OPTIONS.find(
    (option) => option.value === config.modelSelection.model
  )
  const effort = MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === config.effort)
  return `${model?.label ?? config.modelSelection.model} · ${effort?.label ?? config.effort}${config.modelSelection.fastMode ? ' · Fast' : ''}`
}

export const benchmarkComparisonConfigSchema = z
  .object({
    planners: z
      .array(benchmarkModelConfigSchema)
      .min(1)
      .max(6)
      .refine(
        (planners) =>
          new Set(planners.map((planner) => JSON.stringify(planner))).size === planners.length,
        'Choose distinct model and effort combinations'
      ),
    evaluator: benchmarkModelConfigSchema,
  })
  .strict()
