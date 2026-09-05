import { projectJob } from '@/lib/internal/oracle-epm-platform/jobs'
import type { OracleEpmPlatformOperationImplementations } from '@/lib/internal/oracle-epm-platform/operations'
import {
  environmentSchema,
  idleTimeoutSchema,
  jsonBody,
  parseResponse,
  requireSuccess,
  restrictedDataSchema,
  virusScanSchema,
} from '@/lib/internal/oracle-epm-platform/responses'
import { endpoints } from '@/lib/internal/oracle-epm-platform/routes'

export const environmentToolHandlers = {
  get_environment_info: async (_input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.get_environment_info, {
        query: { showTimeZone: true },
        signal,
      })
    )
    return {
      ...requireSuccess(value),
      environments: parseResponse(environmentSchema, value).items.map(({ amwTime, ...item }) => ({
        ...item,
        maintenanceStartTime: amwTime,
      })),
    }
  },
  get_idle_session_timeout: async (_input, { client, signal }) => {
    const value = jsonBody(await client.request(endpoints.get_idle_session_timeout, { signal }))
    return {
      ...requireSuccess(value),
      timeoutMinutes: parseResponse(idleTimeoutSchema, value).items[0].timeout,
    }
  },
  set_idle_session_timeout: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.set_idle_session_timeout, {
          json: { timeout: String(input.timeoutMinutes) },
          signal,
        })
      )
    ),
  set_maintenance_window: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.set_maintenance_window, {
          json: { startTime: input.startTime },
          signal,
        })
      )
    ),
  run_daily_maintenance: async (input, { client, signal }) =>
    projectJob(
      client,
      jsonBody(
        await client.request(endpoints.run_daily_maintenance, {
          json: { skipNext: String(input.skipNext ?? false) },
          signal,
        })
      ),
      'maintenance'
    ),
  get_restricted_data_access: async (_input, { client, signal }) => {
    const value = jsonBody(await client.request(endpoints.get_restricted_data_access, { signal }))
    return {
      ...requireSuccess(value),
      enabled: parseResponse(restrictedDataSchema, value).items[0].dataAccessRestriction,
    }
  },
  set_restricted_data_access: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.set_restricted_data_access, {
          json: { dataAccessRestriction: String(input.enabled) },
          signal,
        })
      )
    ),
  get_upload_virus_scan: async (_input, { client, signal }) => {
    const value = jsonBody(await client.request(endpoints.get_upload_virus_scan, { signal }))
    return {
      ...requireSuccess(value),
      enabled: parseResponse(virusScanSchema, value).items[0].scanfiles,
    }
  },
  set_upload_virus_scan: async (input, { client, signal }) =>
    requireSuccess(
      jsonBody(
        await client.request(endpoints.set_upload_virus_scan, {
          json: { scanfiles: String(input.enabled) },
          signal,
        })
      )
    ),
} satisfies Pick<
  OracleEpmPlatformOperationImplementations,
  | 'get_environment_info'
  | 'get_idle_session_timeout'
  | 'set_idle_session_timeout'
  | 'set_maintenance_window'
  | 'run_daily_maintenance'
  | 'get_restricted_data_access'
  | 'set_restricted_data_access'
  | 'get_upload_virus_scan'
  | 'set_upload_virus_scan'
>
