import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { defineAuthorizedBenchmarkUseCase } from '@/lib/benchmarks/application/access'
import { requireBenchmarkCaseAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import {
  BENCHMARK_LEASE_MS,
  withBenchmarkStageLease,
} from '@/lib/benchmarks/application/stage-lease'
import {
  applyBenchmarkPatch,
  redactBenchmarkSpec,
  validateBenchmarkRedaction,
} from '@/lib/benchmarks/artifacts'
import { getBenchmarkMothershipUrl } from '@/lib/benchmarks/config'
import { gradeReconstruction, validateReconstruction } from '@/lib/benchmarks/evaluation'
import { verifyRecoveryEvidence } from '@/lib/benchmarks/evidence'
import {
  distillationMessages,
  gradingMessages,
  reconstructionMessages,
  redactionMessages,
} from '@/lib/benchmarks/prompts'
import {
  claimBenchmarkStage,
  completeBenchmarkStage,
  failBenchmarkStage,
} from '@/lib/benchmarks/repository'
import {
  type BenchmarkArtifacts,
  type BenchmarkCase,
  type BenchmarkStage,
  benchmarkBlankSchema,
  benchmarkBriefSchema,
  benchmarkGradeSchema,
  benchmarkReconstructionSchema,
  benchmarkSourceSchema,
  benchmarkSpecSchema,
} from '@/lib/benchmarks/types'
import { executeBenchmarkJson, executeBenchmarkPlan } from '@/lib/benchmarks/worker'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('BenchmarkStage')

const distillationSchema = z
  .object({
    taskBrief: benchmarkBriefSchema.min(1),
    referenceSpec: benchmarkSpecSchema
      .min(1)
      .describe(
        'A complete, human-readable Markdown specification, with headings and prose. Use code blocks for exact mappings or code where needed.'
      ),
  })
  .strict()
const redactionSchema = z
  .object({
    blanks: z.array(benchmarkBlankSchema).min(1),
  })
  .strict()
const reconstructionSchema = z
  .object({
    answers: z
      .array(
        benchmarkReconstructionSchema.pick({ id: true, answer: true, support: true }).extend({
          sources: z.array(benchmarkSourceSchema.pick({ citationId: true, quote: true })),
        })
      )
      .min(1),
  })
  .strict()
const gradingSchema = z
  .object({ judgments: z.array(benchmarkGradeSchema.required({ basis: true })).min(1) })
  .strict()

interface RunBenchmarkStageInput {
  organizationId: string
  benchmarkId: string
  version: number
  stage: BenchmarkStage
  runLabel?: string
}

function requireStageInputs(stage: BenchmarkStage, artifacts: BenchmarkArtifacts): void {
  if (stage !== 'distill' && !artifacts.referenceSpec.trim()) {
    throw new OrchestrationError('validation', 'Save a reference spec first')
  }
  if (stage === 'plan' && !artifacts.taskBrief.trim())
    throw new OrchestrationError('validation', 'Save a task brief before planning')
  if (stage === 'plan' || stage === 'reconstruct' || stage === 'grade') {
    validateBenchmarkRedaction(artifacts)
    if (!artifacts.blanks.length)
      throw new OrchestrationError('validation', 'Generate and review the blanks first')
  }
  if ((stage === 'reconstruct' || stage === 'grade') && !artifacts.generatedSpec?.trim()) {
    throw new OrchestrationError('validation', 'Run the planner first')
  }
  if (stage === 'grade' && !artifacts.reconstruction)
    throw new OrchestrationError('validation', 'Reconstruct the blanks first')
}

async function performStage(
  principal: Principal,
  benchmark: BenchmarkCase,
  stage: BenchmarkStage,
  signal: AbortSignal
): Promise<{ artifacts: BenchmarkArtifacts; plannerChatId?: string | null }> {
  const artifacts = benchmark.artifacts
  switch (stage) {
    case 'distill': {
      const { data: result } = await executeBenchmarkJson({
        principal,
        benchmark,
        signal,
        schema: distillationSchema,
        messages: distillationMessages(artifacts.taskBrief),
        profile: { stage: 'distill' },
      })
      return { artifacts: applyBenchmarkPatch(artifacts, result), plannerChatId: null }
    }
    case 'redact': {
      const { data: result } = await executeBenchmarkJson({
        principal,
        benchmark,
        signal,
        schema: redactionSchema,
        messages: redactionMessages(artifacts.referenceSpec),
      })
      return {
        artifacts: applyBenchmarkPatch(artifacts, {
          ...result,
          redactedSpec: redactBenchmarkSpec(artifacts.referenceSpec, result.blanks),
        }),
      }
    }
    case 'plan': {
      const result = await executeBenchmarkPlan({ principal, benchmark, signal })
      return {
        artifacts: {
          ...artifacts,
          generatedSpec: result.generatedSpec,
          reconstruction: null,
          grade: null,
        },
        plannerChatId: result.plannerChatId,
      }
    }
    case 'reconstruct': {
      const { data: result, toolCalls } = await executeBenchmarkJson({
        principal,
        benchmark,
        signal,
        schema: reconstructionSchema,
        messages: reconstructionMessages(artifacts.redactedSpec),
        profile: { stage: 'resolve', spec: artifacts.generatedSpec! },
      })
      validateReconstruction(artifacts.blanks, result.answers)
      const reconstruction = verifyRecoveryEvidence(
        artifacts.generatedSpec!,
        result.answers,
        toolCalls
      )
      return {
        artifacts: { ...artifacts, recoveryMode: 'references', reconstruction, grade: null },
      }
    }
    case 'grade': {
      const { data: result } = await executeBenchmarkJson({
        principal,
        benchmark,
        signal,
        schema: gradingSchema,
        messages: gradingMessages(artifacts),
      })
      const grade = gradeReconstruction({
        blanks: artifacts.blanks,
        reconstruction: artifacts.reconstruction!,
        generatedSpec: artifacts.generatedSpec!,
        judgments: result.judgments,
      })
      return { artifacts: { ...artifacts, grade } }
    }
  }
}

/** Each step claims a bounded lease, retains independent artifacts, and reauthorizes before publication. */
export const runBenchmarkStage = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.run,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: RunBenchmarkStageInput
    request?: { signal?: AbortSignal }
  }) {
    const current = await requireBenchmarkCaseAccess(principal, input)
    if (current.version !== input.version)
      throw new OrchestrationError(
        'conflict',
        'This benchmark changed. Refresh it before running a step.'
      )
    getBenchmarkMothershipUrl()
    requireStageInputs(input.stage, current.artifacts)
    request?.signal?.throwIfAborted()
    const scope = {
      organizationId: input.organizationId,
      userId: current.userId,
      benchmarkId: current.id,
    }
    const attemptId = generateId()
    const claimed = await claimBenchmarkStage({
      ...scope,
      expectedVersion: input.version,
      stage: input.stage,
      attemptId,
      leaseExpiresAt: new Date(Date.now() + BENCHMARK_LEASE_MS),
    })
    const attempt = { ...scope, version: claimed.version, stage: input.stage, attemptId }
    logger.info('Benchmark step started', {
      ...attempt,
      operatorUserId: current.userId,
      runAsUserId: current.runAsUserId ?? current.userId,
    })
    try {
      const output = await withBenchmarkStageLease(attempt, request?.signal, (signal) =>
        performStage(principal, claimed, input.stage, signal)
      )
      request?.signal?.throwIfAborted()
      await requireBenchmarkCaseAccess(principal, input)
      return {
        benchmark: await completeBenchmarkStage({
          ...attempt,
          ...output,
          runLabel: input.runLabel,
        }),
      }
    } catch (error) {
      const message = request?.signal?.aborted
        ? 'This step was interrupted. Retry it.'
        : error instanceof OrchestrationError
          ? error.message
          : 'This benchmark step failed. Retry it or inspect the server logs.'
      logger.warn('Benchmark step failed', {
        benchmarkId: current.id,
        stage: input.stage,
        attemptId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      })
      try {
        await failBenchmarkStage({ ...attempt, error: message })
      } catch (persistenceError) {
        logger.warn('Benchmark failure state could not be saved; its lease will expire', {
          benchmarkId: current.id,
          stage: input.stage,
          attemptId,
          errorType: persistenceError instanceof Error ? persistenceError.name : 'UnknownError',
        })
      }
      if (!request?.signal?.aborted && error instanceof OrchestrationError) throw error
      throw new OrchestrationError(request?.signal?.aborted ? 'validation' : 'internal', message)
    }
  },
})
