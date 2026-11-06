import { filterUndefined } from '@sim/utils/object'
import {
  CONNECTION_PROPERTIES,
  type FivetranConnectionResponse,
  type FivetranRunConnectionSetupTestsParams,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRUST_PARAMS,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapConnection,
  optionalBoolean,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranRunConnectionSetupTestsTool: ToolConfig<
  FivetranRunConnectionSetupTestsParams,
  FivetranConnectionResponse
> = {
  id: 'fivetran_run_connection_setup_tests',
  name: 'Fivetran Run Connection Setup Tests',
  description:
    'Run the setup tests of a Fivetran connection without changing its configuration, and return each test result.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    ...FIVETRAN_TRUST_PARAMS,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/test`),
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
      output: { connection: mapConnection(envelopeData(await response.json())) },
    }
  },

  outputs: {
    connection: {
      type: 'object',
      description: 'The connection with its setup test results in setupTests',
      properties: CONNECTION_PROPERTIES,
    },
  },
}
