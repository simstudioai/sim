import type { Principal } from '@sim/auth/principal'
import { requireBenchmarkCaseAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import {
  getBenchmarkRunRecord,
  listBenchmarkRunRecords,
  reviewBenchmarkRunRecord,
} from '@/lib/benchmarks/repository'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'

interface BenchmarkRunInput {
  organizationId: string
  benchmarkId: string
}

export const listBenchmarkRuns = defineAuthorizedOrganizationUseCase({
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

export const getBenchmarkRun = defineAuthorizedOrganizationUseCase({
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

export const reviewBenchmarkRun = defineAuthorizedOrganizationUseCase({
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
