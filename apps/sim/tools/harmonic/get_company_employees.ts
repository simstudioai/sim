import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
  type HarmonicGetCompanyEmployeesParams,
  type HarmonicGetCompanyEmployeesResponse,
} from '@/tools/harmonic/types'
import {
  buildCompanyEmployeesUrl,
  harmonicHeaders,
  normalizePageInfo,
  normalizePersonUrnList,
  nullableResponseNumber,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetCompanyEmployeesTool: ToolConfig<
  HarmonicGetCompanyEmployeesParams,
  HarmonicGetCompanyEmployeesResponse
> = {
  id: 'harmonic_get_company_employees',
  name: 'Harmonic Get Company Employees',
  description:
    'List person URNs for a company, filtered by role group and employment status. Pair with Batch Get People to hydrate contacts.',
  version: '1.0.0',
  oauth: { required: true, provider: 'harmonic' },
  errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Harmonic credential resolved by the connected account',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Harmonic company ID or full company URN',
    },
    employeeGroupType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Role group: CEO, FOUNDERS_AND_CEO, EXECUTIVES, FOUNDERS, LEADERSHIP, NON_LEADERSHIP, ALL, ADVISORS, NON_PARTNERS (default ALL)',
    },
    employeeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Employment status: ACTIVE, NOT_ACTIVE, or ACTIVE_AND_NOT_ACTIVE (default ACTIVE)',
    },
    userConnectionStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Connection filter: TEAM_CONNECTION or NO_CONNECTION. Harmonic documents per-user connection filtering as unsupported via the API',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results to return; Sim caps this at 100 per page (default 50)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque next-page cursor from a previous response',
    },
  },

  request: {
    url: (params) =>
      buildCompanyEmployeesUrl(params.companyId, {
        employeeGroupType: params.employeeGroupType,
        employeeStatus: params.employeeStatus,
        userConnectionStatus: params.userConnectionStatus,
        size: params.size,
        cursor: params.cursor,
      }),
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'company employees')
    return {
      success: true,
      output: {
        personUrns: normalizePersonUrnList(data.results, 'company employees'),
        totalCount: nullableResponseNumber(data.count),
        pageInfo: normalizePageInfo(data.page_info),
      },
    }
  },

  outputs: {
    personUrns: {
      type: 'array',
      description: 'Person URNs for the matching employees; Harmonic returns URNs only',
      items: { type: 'string', description: 'Harmonic person URN' },
    },
    totalCount: { type: 'number', nullable: true, description: 'Total matching employees' },
    pageInfo: {
      type: 'object',
      nullable: true,
      description: 'Cursor pagination metadata',
      properties: HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
