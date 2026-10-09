import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  CheckrListReportAddressesParams,
  CheckrListReportAddressesResponse,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrId,
  checkrPaginationQuery,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListReportAddressesTool: ToolConfig<
  CheckrListReportAddressesParams,
  CheckrListReportAddressesResponse
> = {
  id: 'checkr_list_report_addresses',
  name: 'Checkr List Report Addresses',
  description: 'List the address history found for a report.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl(
        `/reports/${checkrId(params.reportId, 'reportId')}/addresses`,
        checkrPaginationQuery(params)
      ),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        addresses: toArray(data.data).map((value) => {
          const address = toRecord(value)
          return {
            name: toStringOrNull(address.name),
            city: toStringOrNull(address.city),
            state: toStringOrNull(address.state),
            startDate: toStringOrNull(address.start_date),
            endDate: toStringOrNull(address.end_date),
          }
        }),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    addresses: {
      type: 'array',
      description: 'Addresses found for the report',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Location name', nullable: true },
          city: { type: 'string', description: 'City', nullable: true },
          state: { type: 'string', description: 'State', nullable: true },
          startDate: { type: 'string', description: 'Start of residence', nullable: true },
          endDate: { type: 'string', description: 'End of residence', nullable: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of addresses', nullable: true },
  },
}
