import { filterUndefined } from '@sim/utils/object'
import {
  DESTINATION_PROPERTIES,
  type FivetranCreateDestinationParams,
  type FivetranDestinationResponse,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRUST_PARAMS,
  fivetranHeaders,
  fivetranUrl,
  mapDestination,
  optionalBoolean,
  parseJsonObject,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranCreateDestinationTool: ToolConfig<
  FivetranCreateDestinationParams,
  FivetranDestinationResponse
> = {
  id: 'fivetran_create_destination',
  name: 'Fivetran Create Destination',
  description:
    'Create the destination for a Fivetran group, such as a Databricks workspace. The config object holds the destination-specific connection settings.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the group the destination belongs to (each group has one destination)',
    },
    service: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination type, e.g. databricks, snowflake, or big_query',
    },
    timeZoneOffset: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UTC offset used for sync scheduling, from -11 to +12, e.g. -5 or 0',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data processing region, e.g. AWS_US_EAST_1 or GCP_US_EAST4',
    },
    config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Destination-specific settings, e.g. for Databricks {"server_host_name": "...", "http_path": "...", "catalog": "...", "auth_type": "PERSONAL_ACCESS_TOKEN", "personal_access_token": "..."}',
    },
    daylightSavingTimeEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shift the UTC offset with daylight saving time (US only)',
    },
    runSetupTests: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run the setup tests after creating the destination',
    },
    ...FIVETRAN_TRUST_PARAMS,
  },

  request: {
    url: () => fivetranUrl('/destinations'),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) =>
      filterUndefined({
        group_id: params.groupId?.trim(),
        service: params.service?.trim(),
        time_zone_offset: trimmed(params.timeZoneOffset),
        region: trimmed(params.region),
        config: parseJsonObject(params.config, 'config'),
        daylight_saving_time_enabled: optionalBoolean(params.daylightSavingTimeEnabled),
        run_setup_tests: optionalBoolean(params.runSetupTests),
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
      description: 'The created destination, with setup test results when they ran',
      properties: DESTINATION_PROPERTIES,
    },
  },
}
