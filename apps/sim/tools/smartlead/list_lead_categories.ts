import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadLeadCategoriesResponse } from '@/tools/smartlead/types'
import {
  leadCategoriesOutputs,
  mapLeadCategory,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const listLeadCategoriesTool: ToolConfig<
  SmartleadBaseParams,
  SmartleadLeadCategoriesResponse
> = {
  id: 'smartlead_list_lead_categories',
  name: 'Smartlead List Lead Categories',
  description:
    'Retrieves the lead categories configured on the Smartlead account, with the category IDs needed to categorize a lead.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
  },
  request: {
    url: (params) => smartleadUrl('/leads/fetch-categories', params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const data = await smartleadArray(response, 'lead categories')
    const categories = data.map(mapLeadCategory)

    return {
      success: true,
      output: {
        categories,
        count: categories.length,
      },
    }
  },
  outputs: leadCategoriesOutputs,
}
