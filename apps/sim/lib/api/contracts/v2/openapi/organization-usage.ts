import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2GetOrganizationMemberUsageLimitContract,
  v2GetOrganizationUsageBreakdownContract,
  v2GetOrganizationUsageSummaryContract,
  v2ListOrganizationUsageEventsContract,
  v2UpdateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/v2/organization-usage'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { memberUsageLimitOperations } from '@/lib/billing/application/member-usage-limits/operations'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'

export const organizationUsageOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetOrganizationMemberUsageLimitContract,
    {
      applicationOperation: memberUsageLimitOperations.read,
      operationId: 'getOrganizationMemberUsageLimit',
      summary: 'Get Organization Member Credit Limit',
      description: `Read a person’s credit cap and credits consumed in the organization billing period. Hosted only. The userId identifies a user, including an external workspace collaborator; it is not a membership record ID. Null means no per-person cap, while organization limits still apply. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Get Organization Member Credit Limit result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.params,
        'GetOrganizationMemberUsageLimitParams',
        'Get Organization Member Credit Limit parameters',
        'Organization and target user identifiers, where applicable.'
      ),
      query: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.query,
        'GetOrganizationMemberUsageLimitQuery',
        'Get Organization Member Credit Limit query',
        'Reporting window, filtering, and pagination controls, where applicable.'
      ),
      response: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.response.schema,
        'GetOrganizationMemberUsageLimitResponse',
        'Get Organization Member Credit Limit response',
        'Get Organization Member Credit Limit result.',
        [{ data: { creditsUsed: 200, creditLimit: 10000, billingInterval: 'month' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateOrganizationMemberUsageLimitContract,
    {
      applicationOperation: memberUsageLimitOperations.update,
      operationId: 'updateOrganizationMemberUsageLimit',
      summary: 'Update Organization Member Credit Limit',
      description: `Set or clear a person’s credit cap. Hosted only. The userId can identify an external workspace collaborator. The cap is a nonnegative whole number of credits, not dollars: 0 prevents further credit-consuming usage; null removes the per-person cap. Organization limits continue to apply. Retrying the same value is safe. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Update Organization Member Credit Limit result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.params,
        'UpdateOrganizationMemberUsageLimitParams',
        'Update Organization Member Credit Limit parameters',
        'Organization and target user identifiers, where applicable.'
      ),
      query: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.query,
        'UpdateOrganizationMemberUsageLimitQuery',
        'Update Organization Member Credit Limit query',
        'Reporting window, filtering, and pagination controls, where applicable.'
      ),
      body: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.body,
        'UpdateOrganizationMemberUsageLimitBody',
        'Update Organization Member Credit Limit body',
        'Credit cap in whole credits; null clears the cap.',
        [{ creditLimit: 10000 }, { creditLimit: null }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.response.schema,
        'UpdateOrganizationMemberUsageLimitResponse',
        'Update Organization Member Credit Limit response',
        'Update Organization Member Credit Limit result.',
        [{ data: { creditLimit: 10000 } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationUsageSummaryContract,
    {
      applicationOperation: organizationUsageOperations.readSummary,
      operationId: 'getOrganizationUsageSummary',
      summary: 'Get Organization Usage Summary',
      description: `Read pooled credits, a usage series, and an exact previous-period comparison when available. Requires organization administrator access and Usage Monitoring (Enterprise on hosted; enabled on self-hosted). Defaults to 30 days. Custom dates include both dates in the selected timezone and cannot exceed 92 days. Billing windows exceeding 366 days are rejected. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Get Organization Usage Summary result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationUsageSummaryContract.params,
        'GetOrganizationUsageSummaryParams',
        'Get Organization Usage Summary parameters',
        'Organization and target user identifiers, where applicable.'
      ),
      query: documentedSchema(
        v2GetOrganizationUsageSummaryContract.query,
        'GetOrganizationUsageSummaryQuery',
        'Get Organization Usage Summary query',
        'Reporting window, filtering, and pagination controls, where applicable.'
      ),
      response: documentedSchema(
        v2GetOrganizationUsageSummaryContract.response.schema,
        'GetOrganizationUsageSummaryResponse',
        'Get Organization Usage Summary response',
        'Get Organization Usage Summary result.',
        [
          {
            data: {
              window: {
                start: '2026-06-01T00:00:00.000Z',
                end: '2026-07-01T00:00:00.000Z',
                source: 'range',
              },
              bucket: 'day',
              totals: { credits: 200 },
              previousTotals: null,
              series: [{ timestamp: '2026-06-01T00:00:00.000Z', credits: 200, events: 1 }],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationUsageBreakdownContract,
    {
      applicationOperation: organizationUsageOperations.readBreakdown,
      operationId: 'getOrganizationUsageBreakdown',
      summary: 'Get Organization Usage Breakdown',
      description: `Read ranked organization usage by member, workspace, workflow, model, BYOK provider, or source. Requires organization administrator access and Usage Monitoring. Omitted usage is summarized in other. BYOK ranks tokens; other dimensions rank cost. More than 10,000 underlying groups returns 413; narrow the window or workspace. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Get Organization Usage Breakdown result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.params,
        'GetOrganizationUsageBreakdownParams',
        'Get Organization Usage Breakdown parameters',
        'Organization and target user identifiers, where applicable.'
      ),
      query: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.query,
        'GetOrganizationUsageBreakdownQuery',
        'Get Organization Usage Breakdown query',
        'Reporting window, filtering, and pagination controls, where applicable.'
      ),
      response: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.response.schema,
        'GetOrganizationUsageBreakdownResponse',
        'Get Organization Usage Breakdown response',
        'Get Organization Usage Breakdown result.',
        [
          {
            data: {
              dimension: 'member',
              rows: [
                { id: 'user-123', label: 'Example Member', credits: 200, events: 1, share: 1 },
              ],
              other: { credits: 0, events: 0, rowCount: 0, tokens: 0 },
              totalCredits: 200,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationUsageEventsContract,
    {
      applicationOperation: organizationUsageOperations.listEvents,
      operationId: 'listOrganizationUsageEvents',
      summary: 'List Organization Usage Events',
      description: `Page through usage events, including zero-cost reporting. Requires organization administrator access and Usage Monitoring. Defaults to 30 days. Cursors retain the initial reporting window; keep filters and sort unchanged while paging. The sim-chat source covers both chat surfaces. Per-event rounding can produce credits=0 with hasCost=true. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'List Organization Usage Events result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationUsageEventsContract.params,
        'ListOrganizationUsageEventsParams',
        'List Organization Usage Events parameters',
        'Organization and target user identifiers, where applicable.'
      ),
      query: documentedSchema(
        v2ListOrganizationUsageEventsContract.query,
        'ListOrganizationUsageEventsQuery',
        'List Organization Usage Events query',
        'Reporting window, filtering, and pagination controls, where applicable.'
      ),
      response: documentedSchema(
        v2ListOrganizationUsageEventsContract.response.schema,
        'ListOrganizationUsageEventsResponse',
        'List Organization Usage Events response',
        'List Organization Usage Events result.',
        [
          {
            data: [
              {
                id: 'event-123',
                createdAt: '2026-06-01T09:00:00.000Z',
                source: 'sim-chat',
                description: 'Model usage',
                workflowName: null,
                credits: 200,
                hasCost: true,
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
] as const
