import {
  v2GetBillingStatusContract,
  v2ListBillingLogsContract,
} from '@/lib/api/contracts/v2/billing'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiSuccessMetadata,
} from '@/lib/api/openapi/types'
import { billingOperations } from '@/lib/billing/application/operations'

const BILLING_STATUS_EXAMPLE = {
  data: {
    workspaceId: null,
    period: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    plan: 'pro',
    status: 'active',
    credits: {
      used: 512,
      limit: 20_000,
      remaining: 19_488,
    },
    storage: {
      usedBytes: 5_242_880,
      limitBytes: 1_073_741_824,
      percentUsed: 0.48828125,
    },
  },
} as const

const BILLING_LOGS_EXAMPLE = {
  data: [
    {
      id: 'log_1',
      createdAt: '2026-07-29T18:04:11.000Z',
      source: 'sim-chat',
      workspaceId: 'ws_1',
      workflow: null,
      runId: null,
      creditCost: 12,
    },
  ],
  nextCursor: null,
  scope: 'workspace',
} as const

function billingOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Billing'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}

const routes = [
  defineOpenApiRoute(
    v2GetBillingStatusContract,
    billingOperation({
      applicationOperation: billingOperations.readStatus,
      operationId: 'getBillingStatus',
      summary: 'Get Billing Status',
      description:
        "Return the current plan, billing standing, credit allowance, and storage quota. `credits` and `storage` report the payer's pooled allowances and are null unless the caller can manage that payer's billing; they are always null for a workspace API key. Billing history lives at `GET /api/v2/billing/logs`.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The current billing and storage status.' },
    }),
    {
      query: documentedSchema(
        v2GetBillingStatusContract.query,
        'GetBillingStatusQuery',
        'Get billing status query',
        'Optional workspace scope for resolving the payer.'
      ),
      response: documentedSchema(
        v2GetBillingStatusContract.response.schema,
        'V2BillingStatusResponse',
        'Billing status response',
        'Current billing standing, credit allowance, and storage quota.',
        [BILLING_STATUS_EXAMPLE]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListBillingLogsContract,
    billingOperation({
      applicationOperation: billingOperations.listLogs,
      operationId: 'listBillingLogs',
      summary: 'List Billing Logs',
      description:
        'List the credit-denominated billing ledger with source filtering and opaque cursor pagination. `period` defaults to `30d`, so an unqualified request covers only the last 30 days: paginating to `nextCursor: null` exhausts that window, not the whole ledger. An inverted custom window is a 400 rather than an empty page.',
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of usage events.' },
    }),
    {
      query: documentedSchema(
        v2ListBillingLogsContract.query,
        'ListBillingLogsQuery',
        'List billing logs query',
        'Workspace, source, date-window, and pagination filters for billing history.'
      ),
      response: documentedSchema(
        v2ListBillingLogsContract.response.schema,
        'V2BillingLogListResponse',
        'Billing log list response',
        'A cursor-paginated page of credit-consuming usage events.',
        [BILLING_LOGS_EXAMPLE]
      ),
    }
  ),
] as const

export const billingOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-billing.json',
  info: {
    title: 'Sim API v2 — Billing',
    description:
      'Version 2 of the Sim REST API for billing standing, credit allowance, storage quota, and cursor-paginated usage history.',
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
      name: 'Billing',
      description: 'Inspect billing standing, credit allowance, storage quota, and usage history.',
    },
  ],
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
