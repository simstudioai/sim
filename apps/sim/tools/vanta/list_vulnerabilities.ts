import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_VULNERABILITY_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListVulnerabilitiesParams,
  VantaListVulnerabilitiesResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListVulnerabilitiesTool: ToolConfig<
  VantaListVulnerabilitiesParams,
  VantaListVulnerabilitiesResponse
> = {
  id: 'vanta_list_vulnerabilities',
  name: 'Vanta List Vulnerabilities',
  description:
    'List the vulnerabilities detected across a Vanta account with filters for severity, fixability, SLA deadlines, package, and integration',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query for vulnerabilities',
    },
    severity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by severity: LOW, MEDIUM, HIGH, or CRITICAL',
    },
    isFixAvailable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by whether a fix is available',
    },
    isDeactivated: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by whether vulnerability monitoring is deactivated',
    },
    includeVulnerabilitiesWithoutSlas: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include vulnerabilities that have no SLA deadline',
    },
    packageIdentifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the affected package identifier',
    },
    externalVulnerabilityId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by external vulnerability ID (e.g., a CVE identifier)',
    },
    integrationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the integration that detected the vulnerability',
    },
    vulnerableAssetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the vulnerable asset ID',
    },
    slaDeadlineAfterDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include vulnerabilities with an SLA deadline after this ISO 8601 date',
    },
    slaDeadlineBeforeDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include vulnerabilities with an SLA deadline before this ISO 8601 date',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items per page (1-100, default 10)',
    },
    pageCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor: pass the endCursor from the previous response to fetch the next page',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_list_vulnerabilities',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      q: params.q,
      severity: params.severity,
      isFixAvailable: params.isFixAvailable,
      isDeactivated: params.isDeactivated,
      includeVulnerabilitiesWithoutSlas: params.includeVulnerabilitiesWithoutSlas,
      packageIdentifier: params.packageIdentifier,
      externalVulnerabilityId: params.externalVulnerabilityId,
      integrationId: params.integrationId,
      vulnerableAssetId: params.vulnerableAssetId,
      slaDeadlineAfterDate: params.slaDeadlineAfterDate,
      slaDeadlineBeforeDate: params.slaDeadlineBeforeDate,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListVulnerabilitiesResponse>(
    'Failed to list Vanta vulnerabilities'
  ),

  outputs: {
    vulnerabilities: {
      type: 'array',
      description: 'Vulnerabilities matching the filters',
      items: { type: 'object', properties: VANTA_VULNERABILITY_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      optional: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
