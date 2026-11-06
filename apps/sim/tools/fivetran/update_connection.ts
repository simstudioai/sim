import { filterUndefined } from '@sim/utils/object'
import {
  CONNECTION_PROPERTIES,
  type FivetranConnectionResponse,
  type FivetranUpdateConnectionParams,
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
  optionalInteger,
  parseJsonObject,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

/** Fields that change the stored connection; Fivetran rejects an update with none of them. */
const PERSISTENT_FIELDS = [
  'config',
  'auth',
  'paused',
  'sync_frequency',
  'schedule_type',
  'daily_sync_time',
  'data_delay_sensitivity',
  'data_delay_threshold',
  'pause_after_trial',
  'is_historical_sync',
] as const

export const fivetranUpdateConnectionTool: ToolConfig<
  FivetranUpdateConnectionParams,
  FivetranConnectionResponse
> = {
  id: 'fivetran_update_connection',
  name: 'Fivetran Update Connection',
  description:
    'Update a Fivetran connection: pause or resume it, change its sync frequency or schedule, or update its configuration.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    paused: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true pauses the connection, false resumes it',
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
    pauseAfterTrial: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pause the connection when its free trial ends',
    },
    isHistoricalSync: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true triggers a re-sync of all historical data',
    },
    config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Connector-specific configuration fields to change',
    },
    auth: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Connector-specific authorization settings to change',
    },
    runSetupTests: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run the setup tests after the update',
    },
    ...FIVETRAN_TRUST_PARAMS,
  },

  request: {
    url: (params) => fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}`),
    method: 'PATCH',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const body = filterUndefined({
        config: parseJsonObject(params.config, 'config'),
        auth: parseJsonObject(params.auth, 'auth'),
        paused: optionalBoolean(params.paused),
        sync_frequency: optionalInteger(params.syncFrequency, 'syncFrequency'),
        schedule_type: trimmed(params.scheduleType),
        daily_sync_time: trimmed(params.dailySyncTime),
        data_delay_sensitivity: trimmed(params.dataDelaySensitivity),
        data_delay_threshold: optionalInteger(params.dataDelayThreshold, 'dataDelayThreshold'),
        pause_after_trial: optionalBoolean(params.pauseAfterTrial),
        is_historical_sync: optionalBoolean(params.isHistoricalSync),
        run_setup_tests: optionalBoolean(params.runSetupTests),
        trust_certificates: optionalBoolean(params.trustCertificates),
        trust_fingerprints: optionalBoolean(params.trustFingerprints),
      })
      if (!PERSISTENT_FIELDS.some((field) => field in body)) {
        throw new Error(
          'Provide at least one setting to change, such as paused, syncFrequency, scheduleType, or config.'
        )
      }
      return body
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
      description: 'The updated connection',
      properties: CONNECTION_PROPERTIES,
    },
  },
}
