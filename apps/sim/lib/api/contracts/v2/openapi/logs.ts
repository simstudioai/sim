import { v2GetLogContract, v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import { v2GetLogStatsContract } from '@/lib/api/contracts/v2/logs-stats'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RUN_RETENTION,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
} from '@/lib/api/openapi/types'
import { logOperations } from '@/lib/logs/application/operations'

const RUN_ID = 'e4f8d2b6-9a1c-4e3d-8b7f-5c0a2d9e6f13'
const WORKFLOW_ID = '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'

const LOG_LIST_EXAMPLE = {
  data: [
    {
      kind: 'workflow',
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
      deploymentVersionId: 'dep_2c4e6a8b0d1f',
      status: 'completed',
      level: 'info',
      trigger: 'api',
      startedAt: '2026-01-15T10:30:00.000Z',
      endedAt: '2026-01-15T10:30:01.250Z',
      totalDurationMs: 1250,
      cost: { total: 0.0032 },
      files: [
        {
          id: 'f1c3a7d0-4b52-4a8e-9f61-2d7c8b3e5a04',
          name: 'summary.pdf',
          size: 18422,
          type: 'application/pdf',
          downloadPath: `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/f1c3a7d0-4b52-4a8e-9f61-2d7c8b3e5a04`,
        },
      ],
    },
  ],
  nextCursor: 'eyJzdGFydGVkQXQiOiIyMDI2LTAxLTE1VDEwOjMwOjAwMFoifQ==',
} as const

const LOG_DETAIL_EXAMPLE = {
  data: {
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
    deploymentVersionId: 'dep_2c4e6a8b0d1f',
    status: 'completed',
    level: 'info',
    trigger: 'api',
    startedAt: '2026-01-15T10:30:00.000Z',
    endedAt: '2026-01-15T10:30:01.250Z',
    totalDurationMs: 1250,
    files: null,
    /**
     * Deliberately a different address from `workflow.ownerEmail` below. This is
     * an `api` run, so it executed as the workspace billing account while the
     * workflow still belongs to the person who built it — the distinction the
     * deprecated field cannot express.
     */
    executedByEmail: 'billing@example.com',
    workflow: {
      id: WORKFLOW_ID,
      name: 'Customer Support Agent',
      description: 'Routes incoming support tickets and drafts responses',
      folderPath: '/',
      ownerEmail: 'jane@example.com',
      workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
      createdAt: '2025-01-10T09:00:00.000Z',
      updatedAt: '2025-06-18T16:45:00.000Z',
      deleted: false,
    },
    workflowState: { blocks: {}, edges: [] },
    traceSpans: [],
    finalOutput: { result: 'Hello, world!' },
    cost: {
      total: 0.0032,
      items: [
        { category: 'fixed', description: 'Base execution charge', cost: 0.001 },
        {
          category: 'model',
          description: 'gpt-5',
          cost: 0.0022,
          inputTokens: 1840,
          outputTokens: 260,
        },
      ],
    },
    workflowInput: { ticketId: 'T-4821' },
    createdAt: '2026-01-15T10:30:00.000Z',
  },
} as const

const LOG_STATS_EXAMPLE = {
  data: {
    workflows: [
      {
        workflowId: WORKFLOW_ID,
        workflowName: 'Customer Support Agent',
        segments: [
          {
            timestamp: '2026-01-15T10:00:00.000Z',
            totalExecutions: 40,
            successfulExecutions: 38,
            avgDurationMs: 1180,
          },
        ],
        totalExecutions: 40,
        totalSuccessful: 38,
        overallSuccessRate: 95,
      },
    ],
    workflowsTruncated: false,
    aggregateSegments: [
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        totalExecutions: 40,
        successfulExecutions: 38,
        avgDurationMs: 1180,
      },
    ],
    totalRuns: 40,
    totalErrors: 2,
    avgLatency: 1180,
    timeBounds: { start: '2026-01-15T10:00:00.000Z', end: '2026-01-15T22:00:00.000Z' },
    segmentMs: 600000,
  },
} as const

function logsOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiOperationMetadata['success']
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Logs'],
    success:
      'byStatus' in operation.success
        ? operation.success
        : {
            ...operation.success,
            headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
          },
  }
}

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListLogsContract,
    logsOperation({
      applicationOperation: logOperations.list,
      operationId: 'listLogs',
      summary: 'List Logs',
      description: `List logs with filters, selectable detail, sorting, and cursor pagination. \`includeJobRuns=true\` includes chat and Sim-agent jobs only with \`sortBy=startedAt\`, because other orderings are unsupported. \`files\` contains only run-produced files; use the files API for input attachments. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of execution logs matching the filters.' },
    }),
    {
      query: documentedSchema(
        v2ListLogsContract.query,
        'ListLogsQuery',
        'List logs query',
        'Workspace, execution, date, cost, detail, and pagination filters for execution logs.'
      ),
      response: documentedSchema(
        v2ListLogsContract.response.schema,
        'V2LogListResponse',
        'Log list response',
        'A cursor-paginated page of workflow execution logs.',
        [LOG_LIST_EXAMPLE]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetLogContract,
    logsOperation({
      applicationOperation: logOperations.readDetail,
      operationId: 'getLog',
      summary: 'Get Log',
      description: `Get a run's workflow graph, trace spans, final output, and cost. Trace spans expire separately, so an empty \`traceSpans\` array does not prove none were recorded. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The requested diagnostic log representation.' },
    }),
    {
      query: v2GetLogContract.query,
      params: documentedSchema(
        v2GetLogContract.params,
        'GetLogParams',
        'Get log parameters',
        'Run identifier for the diagnostic log.'
      ),
      response: documentedSchema(
        v2GetLogContract.response.schema,
        'V2LogDetailResponse',
        'Log detail response',
        'The complete diagnostic representation of a workflow run.',
        [LOG_DETAIL_EXAMPLE]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetLogStatsContract,
    logsOperation({
      applicationOperation: logOperations.readStats,
      operationId: 'getLogStats',
      summary: 'Get Log Statistics',
      description: `Get run counts, success and error counts, and latency by workspace or workflow. Default bounds span recorded runs, or the last 24 hours when empty. Buckets may extend past the end. Folder filters include descendants; \`workflowsTruncated\` affects series, not totals. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Bucketed execution statistics for the workspace.' },
    }),
    {
      query: documentedSchema(
        v2GetLogStatsContract.query,
        'GetLogStatsQuery',
        'Log statistics query',
        'Workspace, workflow, folder, trigger, level, date, and bucketing filters.'
      ),
      response: documentedSchema(
        v2GetLogStatsContract.response.schema,
        'V2LogStatsResponse',
        'Log statistics response',
        'Bucketed success rate, error count, and latency for a workspace and its workflows.',
        [LOG_STATS_EXAMPLE]
      ),
    }
  ),
] as const

/** A no-op on these bodyless reads; kept so a future body-taking log operation inherits its 413. */
const routes = declaredRoutes.map(withRequestBodyErrors)

export const logsOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-logs.json',
  info: {
    title: 'Sim API v2 — Logs',
    description:
      'Version 2 of the Sim REST API for workflow execution logs: listing and sorting runs with filters, retrieving complete diagnostic run snapshots, and reading bucketed execution statistics.',
    version: '2.0.0',
    contact: {
      name: 'Sim Support',
      email: 'help@sim.ai',
      url: 'https://www.sim.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Logs',
      description: 'Query workflow execution logs and retrieve complete run diagnostics.',
    },
  ],
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
