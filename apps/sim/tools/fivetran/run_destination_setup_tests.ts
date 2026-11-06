import { filterUndefined } from '@sim/utils/object'
import {
  DESTINATION_PROPERTIES,
  type FivetranDestinationResponse,
  type FivetranRunDestinationSetupTestsParams,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_DESTINATION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRUST_PARAMS,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapDestination,
  optionalBoolean,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranRunDestinationSetupTestsTool: ToolConfig<
  FivetranRunDestinationSetupTestsParams,
  FivetranDestinationResponse
> = {
  id: 'fivetran_run_destination_setup_tests',
  name: 'Fivetran Run Destination Setup Tests',
  description:
    'Run the setup tests of a Fivetran destination, such as a Databricks workspace, and return each test result.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_DESTINATION_ID_PARAM,
    ...FIVETRAN_TRUST_PARAMS,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/destinations/${fivetranId(params.destinationId, 'destinationId')}/test`),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) =>
      filterUndefined({
        trust_certificates: optionalBoolean(params.trustCertificates),
        trust_fingerprints: optionalBoolean(params.trustFingerprints),
      }),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: { destination: mapDestination(envelopeData(await response.json())) },
    }
  },

  outputs: {
    destination: {
      type: 'object',
      description: 'The destination with its setup test results in setupTests',
      properties: DESTINATION_PROPERTIES,
    },
  },
}
