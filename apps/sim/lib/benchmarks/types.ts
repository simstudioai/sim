import { z } from 'zod'

export const BENCHMARK_SPEC_MAX_LENGTH = 100_000
export const BENCHMARK_MAX_BLANKS = 50
export const benchmarkStageSchema = z.enum(['distill', 'redact', 'plan', 'reconstruct', 'grade'])
export const benchmarkNameSchema = z.string().trim().min(1, 'A benchmark name is required').max(200)
export const benchmarkBriefSchema = z.string().max(20_000)
export const benchmarkSpecSchema = z.string().max(BENCHMARK_SPEC_MAX_LENGTH)
export const benchmarkBlankSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,64}$/,
        'Blank IDs must contain letters, numbers, underscores, or hyphens'
      ),
    answer: z.string().min(1, 'A blank must have an answer').max(10_000),
  })
  .strict()
export const benchmarkReconstructionSchema = z
  .object({
    id: benchmarkBlankSchema.shape.id,
    answer: z.string().max(10_000),
    support: z.string().max(20_000),
  })
  .strict()
export const benchmarkGradeSchema = z
  .object({
    id: benchmarkBlankSchema.shape.id,
    correct: z.boolean(),
    reason: z.string().max(5_000),
  })
  .strict()
export const benchmarkArtifactsSchema = z
  .object({
    taskBrief: benchmarkBriefSchema,
    referenceSpec: benchmarkSpecSchema,
    redactedSpec: benchmarkSpecSchema,
    blanks: z.array(benchmarkBlankSchema).max(BENCHMARK_MAX_BLANKS),
    generatedSpec: benchmarkSpecSchema.nullable(),
    reconstruction: z.array(benchmarkReconstructionSchema).max(BENCHMARK_MAX_BLANKS).nullable(),
    grade: z.array(benchmarkGradeSchema).max(BENCHMARK_MAX_BLANKS).nullable(),
  })
  .strict()

export const benchmarkEditablePatchSchema = z
  .object({
    name: benchmarkNameSchema.optional(),
    taskBrief: benchmarkBriefSchema.optional(),
    referenceSpec: benchmarkSpecSchema.optional(),
    redactedSpec: benchmarkSpecSchema.optional(),
    blanks: z.array(benchmarkBlankSchema).max(BENCHMARK_MAX_BLANKS).optional(),
  })
  .strict()

export const benchmarkSummarySchema = z.object({
  id: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  sourceWorkspaceId: z.string().min(1).max(128),
  name: benchmarkNameSchema,
  version: z.number().int().min(1),
  runningStage: benchmarkStageSchema.nullable(),
  attemptId: z.string().max(128).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  plannerChatId: z.string().max(128).nullable(),
  error: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export const benchmarkCaseSchema = benchmarkSummarySchema.extend({
  artifacts: benchmarkArtifactsSchema,
})

export const benchmarkRunLabelSchema = z.string().trim().max(100)
export const benchmarkHumanReviewSchema = z.object({
  id: benchmarkBlankSchema.shape.id,
  correct: z.boolean(),
  note: z.string().trim().max(2_000),
})
export const benchmarkRunSummarySchema = z.object({
  id: z.string().min(1).max(128),
  benchmarkId: z.string().min(1).max(128),
  label: benchmarkRunLabelSchema,
  evaluationKey: z.string().length(64),
  correct: z.number().int().min(0).max(BENCHMARK_MAX_BLANKS),
  automaticCorrect: z.number().int().min(0).max(BENCHMARK_MAX_BLANKS),
  total: z.number().int().min(1).max(BENCHMARK_MAX_BLANKS),
  version: z.number().int().min(1),
  reviewedCount: z.number().int().min(0).max(BENCHMARK_MAX_BLANKS),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export const benchmarkRunSchema = benchmarkRunSummarySchema.extend({
  reviews: z.array(benchmarkHumanReviewSchema).max(BENCHMARK_MAX_BLANKS),
  artifacts: benchmarkArtifactsSchema.extend({
    generatedSpec: benchmarkSpecSchema.min(1),
    reconstruction: z.array(benchmarkReconstructionSchema).min(1).max(BENCHMARK_MAX_BLANKS),
    grade: z.array(benchmarkGradeSchema).min(1).max(BENCHMARK_MAX_BLANKS),
  }),
})

export type BenchmarkStage = z.infer<typeof benchmarkStageSchema>
export type BenchmarkArtifacts = z.infer<typeof benchmarkArtifactsSchema>
export type BenchmarkEditablePatch = z.infer<typeof benchmarkEditablePatchSchema>
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>

export function emptyBenchmarkArtifacts(taskBrief = ''): BenchmarkArtifacts {
  return {
    taskBrief,
    referenceSpec: '',
    redactedSpec: '',
    blanks: [],
    generatedSpec: null,
    reconstruction: null,
    grade: null,
  }
}
