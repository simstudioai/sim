import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadOpaqueListResponse } from '@/tools/smartlead/types'
import {
  opaqueListOutputs,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const listClientsTool: ToolConfig<SmartleadBaseParams, SmartleadOpaqueListResponse> = {
  id: 'smartlead_list_clients',
  name: 'Smartlead List Clients',
  description:
    'Retrieves the clients on a Smartlead agency account, including the client IDs used to scope campaigns and email accounts.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
  },
  request: {
    url: (params) => smartleadUrl('/client/', params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const items = await smartleadArray(response, 'clients')

    return {
      success: true,
      output: { items, count: items.length },
    }
  },
  outputs: opaqueListOutputs,
}
