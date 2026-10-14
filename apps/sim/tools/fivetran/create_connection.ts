import { filterUndefined } from '@sim/utils/object'
import {
  CONNECTION_PROPERTIES,
  type FivetranConnectionResponse,
  type FivetranCreateConnectionParams,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_TRUST_PARAMS,
  fivetranHeaders,
  fivetranUrl,
  mapConnection,
  optionalBoolean,
  optionalInteger,
  parseJsonObject,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranCreateConnectionTool: ToolConfig<
  FivetranCreateConnectionParams,
  FivetranConnectionResponse
> = {
  id: 'fivetran_create_connection',
  name: 'Fivetran Create Connection',
  description:
    'Create a Fivetran connection in a group. The config object holds the connector-specific settings and the destination naming: schema for most connectors, schema_prefix for databases, or schema and table for file connectors.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the destination group to create the connection in',
    },
    service: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Connector type ID, e.g. okta or google_sheets (see List Connector Types)',
    },
    config: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Connector-specific setup configuration, including the destination name: schema (most connectors), schema_prefix (databases), or schema and table (file connectors), e.g. {"schema": "okta", "domain": "acme", "api_token": "..."}',
    },
    auth: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Connector-specific authorization settings, for connectors that take them',
    },
    paused: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create the connection paused',
    },
    syncFrequency: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sync frequency in minutes (1, 5, 15, 30, 60, 120, 180, 360, 480, 720, or 1440)',
    },
    scheduleType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'auto lets Fivetran schedule syncs; manual runs syncs only on request',
    },
    dailySyncTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Daily sync start time (HH:MM) when the sync frequency is 1440',
    },
    dataDelaySensitivity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data delay notification level: LOW, NORMAL, HIGH, CUSTOM, or SYNC_FREQUENCY',
    },
    dataDelayThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom data delay threshold in minutes, used with CUSTOM sensitivity',
    },
    destinationSchemaNames: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination schema naming: FIVETRAN_NAMING or SOURCE_NAMING',
    },
    pauseAfterTrial: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pause the connection when its free trial ends',
    },
    runSetupTests: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run the setup tests after creating the connection',
    },
    ...FIVETRAN_TRUST_PARAMS,
  },

  request: {
    url: () => fivetranUrl('/connections'),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const config = parseJsonObject(params.config, 'config')
      if (!config) {
        throw new Error('Provide the connection config, including its destination schema name.')
      }
      return filterUndefined({
        group_id: params.groupId?.trim(),
        service: params.service?.trim(),
        config,
        auth: parseJsonObject(params.auth, 'auth'),
        paused: optionalBoolean(params.paused),
        sync_frequency: optionalInteger(params.syncFrequency, 'syncFrequency'),
        schedule_type: trimmed(params.scheduleType),
        daily_sync_time: trimmed(params.dailySyncTime),
        data_delay_sensitivity: trimmed(params.dataDelaySensitivity),
        data_delay_threshold: optionalInteger(params.dataDelayThreshold, 'dataDelayThreshold'),
        destination_schema_names: trimmed(params.destinationSchemaNames),
        pause_after_trial: optionalBoolean(params.pauseAfterTrial),
        run_setup_tests: optionalBoolean(params.runSetupTests),
        trust_certificates: optionalBoolean(params.trustCertificates),
        trust_fingerprints: optionalBoolean(params.trustFingerprints),
      })
    },
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
      description: 'The created connection, with setup test results when they ran',
      properties: CONNECTION_PROPERTIES,
    },
  },
}
