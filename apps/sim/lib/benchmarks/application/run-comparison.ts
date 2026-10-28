import type { Principal } from '@sim/auth/principal'
import type { z } from 'zod'
import { defineAuthorizedBenchmarkUseCase } from '@/lib/benchmarks/application/access'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { runBenchmarkStage } from '@/lib/benchmarks/application/run-stage'
import { benchmarkComparisonConfigSchema } from '@/lib/benchmarks/models'
import type { BenchmarkCase } from '@/lib/benchmarks/types'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'

type RunBenchmarkComparisonInput = z.infer<typeof benchmarkComparisonConfigSchema> & {
  organizationId: string
  benchmarkId: string
  version: number
  runLabel?: string
}

/** Every completed model is saved; failure or cancellation stops the remaining work. */
export const runBenchmarkComparison = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.compare,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: RunBenchmarkComparisonInput
    request?: OrchestrationRequestContext
  }) {
    const parsed = benchmarkComparisonConfigSchema.safeParse({
      planners: input.planners,
      evaluator: input.evaluator,
    })
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        'Choose one to six distinct model and effort combinations'
      )
    let version = input.version
    let benchmark: BenchmarkCase | undefined
    for (const planner of parsed.data.planners) {
      for (const stage of ['plan', 'reconstruct', 'grade'] as const) {
        request?.signal?.throwIfAborted()
        const result = await runBenchmarkStage.execute({
          principal,
          input: {
            organizationId: input.organizationId,
            benchmarkId: input.benchmarkId,
            version,
            stage,
            runLabel: input.runLabel,
            model: stage === 'plan' ? planner : parsed.data.evaluator,
          },
          request,
        })
        benchmark = result.benchmark
        version = benchmark.version
      }
    }
    if (!benchmark) throw new OrchestrationError('validation', 'Choose a planner model')
    return { benchmark }
  },
})
