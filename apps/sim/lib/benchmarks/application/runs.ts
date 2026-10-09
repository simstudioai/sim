import type { Principal } from '@sim/auth/principal'
import { defineAuthorizedBenchmarkUseCase } from '@/lib/benchmarks/application/access'
import { requireBenchmarkCaseAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import {
  getBenchmarkRunRecord,
  listBenchmarkRunRecords,
  reviewBenchmarkRunRecord,
} from '@/lib/benchmarks/repository'

interface BenchmarkRunInput {
  organizationId: string
  benchmarkId: string
}

export const listBenchmarkRuns = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.listRuns,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: BenchmarkRunInput & { limit: number; cursor?: string }
  }) {
    const benchmark = await requireBenchmarkCaseAccess(principal, input)
    return listBenchmarkRunRecords({ ...input, userId: benchmark.userId })
  },
})

export const getBenchmarkRun = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.readRun,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: BenchmarkRunInput & { runId: string }
  }) {
    const benchmark = await requireBenchmarkCaseAccess(principal, input)
    return { run: await getBenchmarkRunRecord({ ...input, userId: benchmark.userId }) }
  },
})

export const reviewBenchmarkRun = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.reviewRun,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: BenchmarkRunInput & {
      runId: string
      version: number
      blankId: string
      correct: boolean | null
      note: string
    }
  }) {
    const benchmark = await requireBenchmarkCaseAccess(principal, input)
    return { run: await reviewBenchmarkRunRecord({ ...input, userId: benchmark.userId }) }
  },
})
