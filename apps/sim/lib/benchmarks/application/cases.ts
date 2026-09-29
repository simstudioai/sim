import type { Principal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import {
  benchmarkSourcePrincipal,
  defineAuthorizedBenchmarkUseCase,
} from '@/lib/benchmarks/application/access'
import {
  benchmarkOperations,
  benchmarkSourceOperation,
} from '@/lib/benchmarks/application/operations'
import { applyBenchmarkPatch } from '@/lib/benchmarks/artifacts'
import { requireBenchmarkEnabled } from '@/lib/benchmarks/config'
import {
  createBenchmarkRecord,
  deleteBenchmarkRecord,
  getBenchmarkRecord,
  listBenchmarkRecords,
  updateBenchmarkRecord,
} from '@/lib/benchmarks/repository'
import {
  type BenchmarkEditablePatch,
  type BenchmarkSummary,
  benchmarkEditablePatchSchema,
  emptyBenchmarkArtifacts,
} from '@/lib/benchmarks/types'
import { authorizeWorkspaceOperation } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowDelegationPolicy } from '@/lib/workflows/application/authorization'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

interface BenchmarkInput {
  organizationId: string
  benchmarkId: string
}

/** Organization membership never grants access to the source workspace by itself. */
export async function requireBenchmarkSourceAccess(
  principal: Principal,
  organizationId: string,
  sourceWorkspaceId: string,
  runAsUserId: string
) {
  requireBenchmarkEnabled()
  const targetPrincipal = await benchmarkSourcePrincipal(principal, {
    organizationId,
    sourceWorkspaceId,
    runAsUserId,
  })
  const context = await resolveActiveWorkspaceApplicationContext(sourceWorkspaceId)
  if (context.workspaceOrganizationId !== organizationId)
    throw new OrchestrationError('not_found', 'Workspace not found')
  await authorizeWorkspaceOperation(targetPrincipal, benchmarkSourceOperation, context, {
    delegation: workflowDelegationPolicy,
  })
  return context
}

async function readOwnedBenchmark(principal: Principal, input: BenchmarkInput, userId: string) {
  requireBenchmarkEnabled()
  const benchmark = await getBenchmarkRecord({ ...input, userId })
  await requireBenchmarkSourceAccess(
    principal,
    input.organizationId,
    benchmark.sourceWorkspaceId,
    benchmark.runAsUserId ?? benchmark.userId
  )
  return benchmark
}

export const listBenchmarks = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.list,
  async execute({
    principal,
    context,
    input,
  }: {
    principal: Principal
    context: { userId: string }
    input: { organizationId: string; limit: number; cursor?: string; runAsUserId?: string }
  }) {
    requireBenchmarkEnabled()
    const page = await listBenchmarkRecords({ ...input, userId: context.userId })
    const benchmarks: BenchmarkSummary[] = []
    for (const benchmark of page.benchmarks) {
      try {
        await requireBenchmarkSourceAccess(
          principal,
          input.organizationId,
          benchmark.sourceWorkspaceId,
          benchmark.runAsUserId ?? benchmark.userId
        )
        benchmarks.push(benchmark)
      } catch (error) {
        if (
          !(error instanceof OrchestrationError) ||
          !['forbidden', 'not_found'].includes(error.code)
        )
          throw error
      }
    }
    return { benchmarks, nextCursor: page.nextCursor }
  },
})

export const getBenchmark = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.read,
  async execute({
    principal,
    context,
    input,
  }: {
    principal: Principal
    context: { userId: string }
    input: BenchmarkInput
  }) {
    return { benchmark: await readOwnedBenchmark(principal, input, context.userId) }
  },
})

/** Reusable admission for stage orchestration; retains current actor, organization, and source access. */
export async function requireBenchmarkCaseAccess(principal: Principal, input: BenchmarkInput) {
  return (await getBenchmark.execute({ principal, input })).benchmark
}

export const createBenchmark = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.create,
  async execute({
    principal,
    context,
    input,
  }: {
    principal: Principal
    context: { userId: string }
    input: {
      organizationId: string
      sourceWorkspaceId: string
      name: string
      taskBrief?: string
      runAsUserId: string
    }
  }) {
    await requireBenchmarkSourceAccess(
      principal,
      input.organizationId,
      input.sourceWorkspaceId,
      input.runAsUserId
    )
    return {
      benchmark: await createBenchmarkRecord({
        ...input,
        benchmarkId: generateId(),
        userId: context.userId,
        artifacts: emptyBenchmarkArtifacts(input.taskBrief),
      }),
    }
  },
})

export const updateBenchmark = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.update,
  async execute({
    principal,
    context,
    input,
  }: {
    principal: Principal
    context: { userId: string }
    input: BenchmarkInput & { version: number; patch: BenchmarkEditablePatch }
  }) {
    const current = await readOwnedBenchmark(principal, input, context.userId)
    if (current.version !== input.version)
      throw new OrchestrationError('conflict', 'This benchmark changed. Refresh it before saving.')
    const parsed = benchmarkEditablePatchSchema.safeParse(input.patch)
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      throw new OrchestrationError('validation', 'Provide at least one editable benchmark field')
    return {
      benchmark: await updateBenchmarkRecord({
        ...input,
        userId: context.userId,
        name: parsed.data.name ?? current.name,
        artifacts: applyBenchmarkPatch(current.artifacts, parsed.data),
      }),
    }
  },
})

export const deleteBenchmark = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.delete,
  async execute({
    principal,
    context,
    input,
  }: {
    principal: Principal
    context: { userId: string }
    input: BenchmarkInput & { version: number }
  }) {
    const current = await readOwnedBenchmark(principal, input, context.userId)
    if (current.version !== input.version)
      throw new OrchestrationError(
        'conflict',
        'This benchmark changed. Refresh it before deleting.'
      )
    await deleteBenchmarkRecord({ ...input, userId: context.userId })
    return { success: true as const }
  },
})
