import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  benchmarkBriefSchema,
  benchmarkCaseSchema,
  benchmarkEditablePatchSchema,
  benchmarkNameSchema,
  benchmarkStageSchema,
  benchmarkSummarySchema,
} from '@/lib/benchmarks/types'

export const benchmarkOrganizationParamsSchema = z.object({ id: organizationIdSchema })
export const benchmarkParamsSchema = benchmarkOrganizationParamsSchema.extend({
  benchmarkId: z.string().min(1).max(128),
})
export const listBenchmarksQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const createBenchmarkBodySchema = z
  .object({
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
  .extend({ stage: benchmarkStageSchema })
  .strict()
export const benchmarkResponseSchema = z.object({ benchmark: benchmarkCaseSchema })
export const listBenchmarksResponseSchema = z.object({
  benchmarks: z.array(benchmarkSummarySchema).max(50),
  nextCursor: z.string().max(512).nullable(),
})

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

export type ListBenchmarksResponse = z.infer<typeof listBenchmarksResponseSchema>
export type BenchmarkResponse = z.infer<typeof benchmarkResponseSchema>
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>
export type CreateBenchmarkBody = z.input<typeof createBenchmarkBodySchema>
export type UpdateBenchmarkBody = z.input<typeof updateBenchmarkBodySchema>
export type DeleteBenchmarkBody = z.input<typeof deleteBenchmarkBodySchema>
export type RunBenchmarkStageBody = z.input<typeof runBenchmarkStageBodySchema>
