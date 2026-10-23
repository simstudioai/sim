import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { testCaseStatusSchema, testReportSchema } from '@/lib/workflow-tests/protocol'

const versionSchema = z.enum(['draft', 'deployed'])
const testNameSchema = z
  .string()
  .min(1)
  .max(80, 'Test names are at most 80 characters, like billing-routing')

const workspaceParams = z.object({ id: workspaceIdSchema })
const testParams = z.object({ id: workspaceIdSchema, name: testNameSchema })
/** Omitted, runs of both versions are read. */
const versionQuery = z.object({ version: versionSchema.optional() })

const runSummarySchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'passed', 'failed', 'error']),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  error: z.string().nullable(),
  triggeredByUserId: z.string().nullable(),
  version: versionSchema,
  sourceChanged: z.boolean(),
  ranAgainst: z.array(
    z.object({
      workflowId: z.string(),
      name: z.string().nullable(),
      version: z.number().int().nullable(),
      draft: z.boolean(),
      liveVersion: z.number().int().nullable(),
      stale: z.boolean(),
      executionId: z.string().nullable(),
    })
  ),
  current: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})

/** One run with its report, and each case's status while it goes. */
const runDetailSchema = runSummarySchema.extend({
  report: testReportSchema.nullable(),
  /** Each case's status by `describe > it` path while the run goes; null before any. */
  progress: z.record(z.string(), testCaseStatusSchema).nullable(),
})

const testRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  path: z.string(),
  fileId: z.string(),
  caseCount: z.number().int(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  status: z.enum(['passing', 'failing', 'error', 'running', 'changed', 'not_run']),
  recentRuns: z.array(runSummarySchema),
  updatedAt: z.string(),
})

const caseSchema = z.object({
  path: z.array(z.string()),
  mode: z.enum(['run', 'only', 'skip']),
  line: z.number().int().positive(),
  endLine: z.number().int().positive(),
})

export const listWorkflowTestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/tests',
  params: workspaceParams,
  query: versionQuery,
  response: { mode: 'json', schema: z.object({ tests: z.array(testRecordSchema) }) },
})

export type WorkflowTestRecord = ContractJsonResponse<
  typeof listWorkflowTestsContract
>['tests'][number]

export const getWorkflowTestContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/tests/[name]',
  params: testParams,
  query: versionQuery,
  response: {
    mode: 'json',
    schema: z.object({
      test: testRecordSchema.extend({ cases: z.array(caseSchema) }),
      latestRun: runDetailSchema.nullable(),
      history: z.array(runSummarySchema),
    }),
  },
})
export type WorkflowTestDetail = ContractJsonResponse<typeof getWorkflowTestContract>

export const getWorkflowTestRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/tests/[name]/runs/[runId]',
  params: testParams.extend({ runId: z.string().min(1).max(64) }),
  response: { mode: 'json', schema: z.object({ run: runDetailSchema }) },
})

export const runWorkflowTestsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/tests/run',
  params: workspaceParams,
  body: z.object({
    version: versionSchema,
    names: z.array(testNameSchema).min(1).max(100).optional(),
    only: z.array(z.string().min(1).max(500)).min(1).max(100).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({ runs: z.array(z.object({ runId: z.string(), name: z.string() })) }),
  },
})
