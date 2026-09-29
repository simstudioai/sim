import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  benchmarkBlankSchema,
  benchmarkBriefSchema,
  benchmarkCaseSchema,
  benchmarkEditablePatchSchema,
  benchmarkHumanReviewSchema,
  benchmarkNameSchema,
  benchmarkRunLabelSchema,
  benchmarkRunSchema,
  benchmarkRunSummarySchema,
  benchmarkStageSchema,
  benchmarkSummarySchema,
} from '@/lib/benchmarks/types'

export const benchmarkOrganizationParamsSchema = z.object({ id: organizationIdSchema })
export const benchmarkParamsSchema = benchmarkOrganizationParamsSchema.extend({
  benchmarkId: z.string().min(1).max(128),
})
export const benchmarkRunParamsSchema = benchmarkParamsSchema.extend({
  runId: z.string().min(1).max(128),
})
export const listBenchmarksQuerySchema = z.object({
  runAsUserId: z.string().min(1).max(128).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const createBenchmarkBodySchema = z
  .object({
    runAsUserId: z.string().min(1).max(128),
    sourceWorkspaceId: workspaceIdSchema,
    name: benchmarkNameSchema,
    taskBrief: benchmarkBriefSchema.optional(),
  })
  .strict()
export const updateBenchmarkBodySchema = benchmarkEditablePatchSchema
  .extend({ version: z.number().int().min(1) })
  .strict()
export const deleteBenchmarkBodySchema = z.object({ version: z.number().int().min(1) }).strict()
export const runBenchmarkStageBodySchema = deleteBenchmarkBodySchema
  .extend({ stage: benchmarkStageSchema, runLabel: benchmarkRunLabelSchema.optional() })
  .strict()
export const benchmarkResponseSchema = z.object({ benchmark: benchmarkCaseSchema })
export const listBenchmarksResponseSchema = z.object({
  benchmarks: z.array(benchmarkSummarySchema).max(50),
  nextCursor: z.string().max(512).nullable(),
})
export const listBenchmarkRunsResponseSchema = z.object({
  runs: z.array(benchmarkRunSummarySchema).max(50),
  nextCursor: z.string().max(512).nullable(),
})
export const benchmarkRunResponseSchema = z.object({ run: benchmarkRunSchema })
export const reviewBenchmarkRunBodySchema = z
  .object({
    version: z.number().int().min(1),
    blankId: benchmarkBlankSchema.shape.id,
    correct: z.boolean().nullable(),
    note: benchmarkHumanReviewSchema.shape.note.default(''),
  })
  .strict()

export const listBenchmarksContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/benchmarks',
  params: benchmarkOrganizationParamsSchema,
  query: listBenchmarksQuerySchema,
  response: { mode: 'json', schema: listBenchmarksResponseSchema },
})
export const createBenchmarkContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/benchmarks',
  params: benchmarkOrganizationParamsSchema,
  body: createBenchmarkBodySchema,
  response: { mode: 'json', schema: benchmarkResponseSchema },
})
export const getBenchmarkContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]',
  params: benchmarkParamsSchema,
  response: { mode: 'json', schema: benchmarkResponseSchema },
})
export const updateBenchmarkContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]',
  params: benchmarkParamsSchema,
  body: updateBenchmarkBodySchema,
  response: { mode: 'json', schema: benchmarkResponseSchema },
})
export const deleteBenchmarkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]',
  params: benchmarkParamsSchema,
  body: deleteBenchmarkBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
export const runBenchmarkStageContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]/run',
  params: benchmarkParamsSchema,
  body: runBenchmarkStageBodySchema,
  response: { mode: 'json', schema: benchmarkResponseSchema },
})

export const listBenchmarkRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]/runs',
  params: benchmarkParamsSchema,
  query: listBenchmarksQuerySchema,
  response: { mode: 'json', schema: listBenchmarkRunsResponseSchema },
})
export const getBenchmarkRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]/runs/[runId]',
  params: benchmarkRunParamsSchema,
  response: { mode: 'json', schema: benchmarkRunResponseSchema },
})
export const reviewBenchmarkRunContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organizations/[id]/benchmarks/[benchmarkId]/runs/[runId]',
  params: benchmarkRunParamsSchema,
  body: reviewBenchmarkRunBodySchema,
  response: { mode: 'json', schema: benchmarkRunResponseSchema },
})

export type ListBenchmarksResponse = z.infer<typeof listBenchmarksResponseSchema>
export type BenchmarkResponse = z.infer<typeof benchmarkResponseSchema>
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>
export type CreateBenchmarkBody = z.input<typeof createBenchmarkBodySchema>
export type UpdateBenchmarkBody = z.input<typeof updateBenchmarkBodySchema>
export type DeleteBenchmarkBody = z.input<typeof deleteBenchmarkBodySchema>
export type RunBenchmarkStageBody = z.input<typeof runBenchmarkStageBodySchema>
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>
export type BenchmarkRunSummary = z.infer<typeof benchmarkRunSummarySchema>
export type BenchmarkRunResponse = z.infer<typeof benchmarkRunResponseSchema>
export type ListBenchmarkRunsResponse = z.infer<typeof listBenchmarkRunsResponseSchema>
export type ReviewBenchmarkRunBody = z.input<typeof reviewBenchmarkRunBodySchema>

export const benchmarkSelectionQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  cursor: z.string().min(1).max(128).optional(),
  selectedId: z.string().min(1).max(128).optional(),
})
const selectionOptionSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(1_000),
})
const userOptionSchema = selectionOptionSchema.extend({ email: z.string().max(320) })
export const benchmarkOrganizationsResponseSchema = z.object({
  organizations: z.array(selectionOptionSchema).max(50),
  selected: selectionOptionSchema.nullable(),
  nextCursor: z.string().max(128).nullable(),
})
export const benchmarkUsersResponseSchema = z.object({
  users: z.array(userOptionSchema).max(50),
  selected: userOptionSchema.nullable(),
  nextCursor: z.string().max(128).nullable(),
})
export const benchmarkWorkspacesQuerySchema = benchmarkSelectionQuerySchema
  .omit({ selectedId: true })
  .extend({ runAsUserId: z.string().min(1).max(128) })
export const benchmarkWorkspacesResponseSchema = z.object({
  workspaces: z.array(selectionOptionSchema).max(50),
  nextCursor: z.string().max(128).nullable(),
  canPlan: z.boolean(),
})
export const benchmarkAvailabilityResponseSchema = z.object({ available: z.boolean() })
export const benchmarkOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/benchmarks/organizations',
  query: benchmarkSelectionQuerySchema,
  response: { mode: 'json', schema: benchmarkOrganizationsResponseSchema },
})
export const benchmarkUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/benchmarks/organizations/[id]/users',
  params: benchmarkOrganizationParamsSchema,
  query: benchmarkSelectionQuerySchema,
  response: { mode: 'json', schema: benchmarkUsersResponseSchema },
})
export const benchmarkWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/benchmarks/organizations/[id]/workspaces',
  params: benchmarkOrganizationParamsSchema,
  query: benchmarkWorkspacesQuerySchema,
  response: { mode: 'json', schema: benchmarkWorkspacesResponseSchema },
})
export const benchmarkAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/benchmarks/availability',
  response: { mode: 'json', schema: benchmarkAvailabilityResponseSchema },
})
export type BenchmarkSelectionQuery = z.input<typeof benchmarkSelectionQuerySchema>
export type BenchmarkWorkspacesQuery = z.input<typeof benchmarkWorkspacesQuerySchema>
export type BenchmarkOrganizationsResponse = z.output<typeof benchmarkOrganizationsResponseSchema>
export type BenchmarkUsersResponse = z.output<typeof benchmarkUsersResponseSchema>
export type BenchmarkWorkspacesResponse = z.output<typeof benchmarkWorkspacesResponseSchema>
export type BenchmarkAvailabilityResponse = z.output<typeof benchmarkAvailabilityResponseSchema>
