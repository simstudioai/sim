import { toArray, toRecord } from '@sim/utils/object'
import type { CheckrListCountiesParams, CheckrListCountiesResponse } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListCountiesTool: ToolConfig<
  CheckrListCountiesParams,
  CheckrListCountiesResponse
> = {
  id: 'checkr_list_counties',
  name: 'Checkr List Counties',
  description:
    'List US counties for one or more states, with their FIPS codes. Use the county names in report self-disclosures.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    states: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated state FIPS codes, e.g. 08,06 for Colorado and California. Leave empty for every US county',
    },
  },

  request: {
    url: (params) => checkrUrl('/counties', { states: params.states }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = toRecord(await response.json())
    const counties = Object.entries(data).flatMap(([state, value]) =>
      toArray(toRecord(value).counties).map((county) => {
        const c = toRecord(county)
        return {
          state,
          name: typeof c.name === 'string' ? c.name : null,
          fipsCode: typeof c.fips_code === 'string' ? c.fips_code : null,
        }
      })
    )
    return { success: true, output: { counties } }
  },

  outputs: {
    counties: {
      type: 'array',
      description: 'Counties grouped under their state abbreviation',
      items: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'State abbreviation, e.g. CO' },
          name: { type: 'string', description: 'County name, e.g. BOULDER', nullable: true },
          fipsCode: {
            type: 'string',
            description: '5-digit county FIPS code (state + county)',
            nullable: true,
          },
        },
      },
    },
  },
}
