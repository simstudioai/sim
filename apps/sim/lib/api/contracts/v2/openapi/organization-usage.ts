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
      summary: 'Get organization member credit limit',
      description: `Read a person’s credit cap and credits consumed in the organization billing period. Hosted deployments only. The \`userId\` identifies an organization member or external collaborator with workspace access in this organization; it is not a membership record ID. Null means no per-person cap, while organization limits still apply. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The person’s current credit cap and billing-period consumption.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.params,
        'GetOrganizationMemberUsageLimitParams',
        'Get organization member credit limit parameters',
        'Organization and target user IDs.'
      ),
      query: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.query,
        'GetOrganizationMemberUsageLimitQuery',
        'Get organization member credit limit query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetOrganizationMemberUsageLimitContract.response.schema,
        'GetOrganizationMemberUsageLimitResponse',
        'Get organization member credit limit response',
        'The person’s current credit cap and billing-period consumption.',
        [{ data: { creditsUsed: 200, creditLimit: 10000, billingInterval: 'month' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateOrganizationMemberUsageLimitContract,
    {
      applicationOperation: memberUsageLimitOperations.update,
      operationId: 'updateOrganizationMemberUsageLimit',
      summary: 'Update organization member credit limit',
      description: `Set or clear a person’s credit cap. Hosted deployments only. The \`userId\` must identify an organization member or external collaborator with workspace access in this organization. The cap is a nonnegative whole number of credits, not dollars: \`0\` prevents further credit-consuming usage; \`null\` removes the per-person cap. Organization limits continue to apply. Retrying the same value is safe. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The saved credit cap, or null when the cap was cleared.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.params,
        'UpdateOrganizationMemberUsageLimitParams',
        'Update organization member credit limit parameters',
        'Organization and target user IDs.'
      ),
      query: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.query,
        'UpdateOrganizationMemberUsageLimitQuery',
        'Update organization member credit limit query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.body,
        'UpdateOrganizationMemberUsageLimitBody',
        'Update organization member credit limit body',
        'Credit cap in whole credits; null clears the cap.',
        [{ creditLimit: 10000 }, { creditLimit: null }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationMemberUsageLimitContract.response.schema,
        'UpdateOrganizationMemberUsageLimitResponse',
        'Update organization member credit limit response',
        'The saved credit cap, or null when the cap was cleared.',
        [{ data: { creditLimit: 10000 } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationUsageSummaryContract,
    {
      applicationOperation: organizationUsageOperations.readSummary,
      operationId: 'getOrganizationUsageSummary',
      summary: 'Get organization usage summary',
      description: `Read pooled credits, a usage series, and an exact previous-period comparison when available. Requires organization Admin access and Usage Monitoring: Enterprise when billing is enabled, or deployment enablement when billing is disabled. Defaults to 30 days. Custom dates include both dates in the selected timezone and cannot exceed 92 days. Billing windows exceeding 366 days are rejected. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Reporting bounds, pooled credits, and chronological usage buckets.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationUsageSummaryContract.params,
        'GetOrganizationUsageSummaryParams',
        'Get organization usage summary parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2GetOrganizationUsageSummaryContract.query,
        'GetOrganizationUsageSummaryQuery',
        'Get organization usage summary query',
        'Reporting window and optional workspace filter.'
      ),
      response: documentedSchema(
        v2GetOrganizationUsageSummaryContract.response.schema,
        'GetOrganizationUsageSummaryResponse',
        'Get organization usage summary response',
        'Reporting bounds, pooled credits, and chronological usage buckets.',
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
      summary: 'Get organization usage breakdown',
      description: `Read ranked usage by member, workspace, workflow, model, BYOK provider, or source. Requires organization Admin access and Usage Monitoring. \`other\` summarizes groups omitted by the limit. BYOK ranks tokens; other dimensions rank cost. More than 10,000 underlying groups returns \`413\`; narrow the window or workspace. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Ranked usage groups and the combined remainder.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.params,
        'GetOrganizationUsageBreakdownParams',
        'Get organization usage breakdown parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.query,
        'GetOrganizationUsageBreakdownQuery',
        'Get organization usage breakdown query',
        'Reporting window, optional workspace filter, grouping dimension, and result limit.'
      ),
      response: documentedSchema(
        v2GetOrganizationUsageBreakdownContract.response.schema,
        'GetOrganizationUsageBreakdownResponse',
        'Get organization usage breakdown response',
        'Ranked usage groups and the combined remainder.',
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
      summary: 'List organization usage events',
      description: `List usage events, including zero-cost activity. Requires organization Admin access and Usage Monitoring. Defaults to 30 days. Cursors retain the initial reporting window; keep filters and sort unchanged while paging. \`sim-chat\` covers both chat surfaces. Per-event rounding can yield \`credits: 0\` with \`hasCost: true\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of usage events, including zero-cost activity.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationUsageEventsContract.params,
        'ListOrganizationUsageEventsParams',
        'List organization usage events parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListOrganizationUsageEventsContract.query,
        'ListOrganizationUsageEventsQuery',
        'List organization usage events query',
        'Reporting window, source filter, sorting, and pagination.'
      ),
      response: documentedSchema(
        v2ListOrganizationUsageEventsContract.response.schema,
        'ListOrganizationUsageEventsResponse',
        'List organization usage events response',
        'A page of usage events, including zero-cost activity.',
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
