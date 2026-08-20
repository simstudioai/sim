import {
  v2GetLogContract,
  v2ListLogsContract,
  v2QueryLogsContract,
} from '@/lib/api/contracts/v2/logs'
import { v2GetLogStatsContract } from '@/lib/api/contracts/v2/logs-stats'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RUN_RETENTION,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
} from '@/lib/api/openapi/types'

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
      files: null,
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

const LOG_QUERY_EXAMPLE = {
  data: [
    {
      kind: 'workflow',
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
      deploymentVersionId: 'dep_2c4e6a8b0d1f',
      status: 'failed',
      level: 'error',
      trigger: 'schedule',
      startedAt: '2026-01-15T10:30:00.000Z',
      endedAt: '2026-01-15T10:30:09.900Z',
      totalDurationMs: 9900,
      cost: { total: 0.41 },
      files: null,
      workflow: {
        id: WORKFLOW_ID,
        name: 'Nightly Enrichment',
        description: 'Enriches new accounts overnight',
        deleted: false,
      },
    },
  ],
  nextCursor: null,
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
      operationId: 'listLogs',
      summary: 'List Logs',
      description: `List workflow execution logs for a workspace with filters, selectable detail, and opaque cursor pagination. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
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
      operationId: 'getLog',
      summary: 'Get Log',
      description: `Retrieve the diagnostic representation of a run, including its workflow snapshot, trace spans, final output, and cost. Trace spans are pruned on their own retention schedule, so an empty \`traceSpans\` array does not mean the run recorded none. ${FOLDER_TREE_TOO_LARGE}`,
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
    v2QueryLogsContract,
    logsOperation({
      /**
       * Not `queryLogs`: that page slug is already a permanent redirect to
       * `listLogs` from an earlier rename, and reusing it would make one
       * documentation URL mean two different operations over time.
       */
      operationId: 'searchLogs',
      summary: 'Search Logs',
      description: `Search a workspace's workflow runs with the same row filters as \`GET /logs\`, ordered by start time, duration, cost, or status. \`GET /logs\`'s remaining params are not accepted here: \`includeJobRuns\` because job runs cannot participate in these orderings (see below), and \`details\`, \`includeFinalOutput\`, and \`includeTraceSpans\` because this read returns the summary projection only. This is the sortable read: \`GET /logs\` orders by start time alone, which is what its single \`order\` param means, so the additional sort columns live here rather than adding a second spelling of the direction there. Every result carries its workflow summary. Chat and Sim-agent job runs are not included — their cost is stored as a document and their status is not comparable, so they cannot participate in these orderings; use \`GET /logs?includeJobRuns=true\` for the combined start-time sequence. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'A page of workflow runs matching the filters, in the requested order.',
      },
    }),
    {
      query: v2QueryLogsContract.query,
      body: documentedSchema(
        v2QueryLogsContract.body,
        'QueryLogsBody',
        'Query logs body',
        'Filters, ordering, and pagination for a sortable run search.'
      ),
      response: documentedSchema(
        v2QueryLogsContract.response.schema,
        'V2LogQueryResponse',
        'Log query response',
        'A cursor-paginated page of workflow runs in the requested order.',
        [LOG_QUERY_EXAMPLE]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetLogStatsContract,
    logsOperation({
      operationId: 'getLogStats',
      summary: 'Get Log Statistics',
      description: `Bucketed run counts, success rate, error count, and mean latency for a workspace and for each of its workflows — the aggregate a caller would otherwise have to page every run to compute. The window spans the oldest matching run through the later of the newest matching run and now, divided into \`segmentCount\` equal buckets no narrower than one minute. A folder path covers its whole subtree. Per-workflow series are capped and \`workflowsTruncated\` reports whether the cap applied; the workspace totals are always computed from every workflow. ${RUN_RETENTION} ${FOLDER_TREE_TOO_LARGE}`,
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

/** Adds the 413 the query route's body read can raise; a no-op on the bodyless reads. */
const routes = declaredRoutes.map(withRequestBodyErrors)

export const logsOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-logs.json',
  info: {
    title: 'Sim API v2 — Logs',
    description:
      'Version 2 of the Sim REST API for listing workflow execution logs and retrieving complete diagnostic run snapshots.',
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
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
