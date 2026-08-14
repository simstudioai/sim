import { v2GetLogContract, v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RUN_RETENTION,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
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
    cost: { total: 0.0032 },
    createdAt: '2026-01-15T10:30:00.000Z',
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

const routes = [
  defineOpenApiRoute(
    v2ListLogsContract,
    logsOperation({
      operationId: 'listLogs',
      summary: 'List Logs',
      description: `List workflow execution logs for a workspace with filters, selectable detail, and opaque cursor pagination. ${RUN_RETENTION}`,
      errors: RESOURCE_ERRORS,
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
      description:
        'Retrieve the diagnostic representation of a run, including its workflow snapshot, trace spans, final output, and cost. Trace spans are pruned on their own retention schedule, so an empty `traceSpans` array does not mean the run recorded none.',
      errors: RESOURCE_ERRORS,
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
] as const

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
