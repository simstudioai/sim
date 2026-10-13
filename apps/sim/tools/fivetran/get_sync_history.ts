import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import {
  type FivetranGetSyncHistoryParams,
  type FivetranGetSyncHistoryResponse,
  NEXT_CURSOR_OUTPUT,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_PAGINATION_PARAMS,
  fivetranHeaders,
  fivetranId,
  fivetranPaginationQuery,
  fivetranUrl,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

function stageVolume(stages: Record<string, unknown>, stage: string): number | null {
  return toNumberOrNull(toRecord(stages[stage]).volume)
}

export const fivetranGetSyncHistoryTool: ToolConfig<
  FivetranGetSyncHistoryParams,
  FivetranGetSyncHistoryResponse
> = {
  id: 'fivetran_get_sync_history',
  name: 'Fivetran Get Sync History',
  description:
    'List the recent syncs of a Fivetran connection with their outcome, failure reason, and data volume per stage. The time window is at most 7 days and defaults to the last hour.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the time window, ISO 8601 (e.g. 2026-01-01T00:00:00Z)',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the time window, ISO 8601 (e.g. 2026-01-01T01:00:00Z)',
    },
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/sync-history`, {
        start_time: trimmed(params.startTime),
        end_time: trimmed(params.endTime),
        ...fivetranPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return {
      success: true,
      output: {
        syncs: items.map((value) => {
          const sync = toRecord(value)
          const stages = toRecord(sync.stages)
          return {
            syncId: toStringOrNull(sync.sync_id) ?? '',
            status: toStringOrNull(sync.status),
            start: toStringOrNull(sync.start),
            end: toStringOrNull(sync.end),
            reason: toStringOrNull(sync.reason),
            extractVolumeMb: stageVolume(stages, 'extract'),
            processVolumeMb: stageVolume(stages, 'process'),
            loadVolumeMb: stageVolume(stages, 'load'),
          }
        }),
        nextCursor,
      },
    }
  },

  outputs: {
    syncs: {
      type: 'array',
      description: 'Syncs in the time window',
      items: {
        type: 'object',
        properties: {
          syncId: { type: 'string', description: 'Sync ID' },
          status: {
            type: 'string',
            description: 'Outcome (COMPLETED, FAILURE, CANCELED, INCOMPLETE, RESCHEDULED, PAUSED)',
            nullable: true,
          },
          start: { type: 'string', description: 'When the sync started', nullable: true },
          end: { type: 'string', description: 'When the sync finished', nullable: true },
          reason: { type: 'string', description: 'Failure reason', nullable: true },
          extractVolumeMb: {
            type: 'number',
            description: 'Data extracted from the source, in MB',
            nullable: true,
          },
          processVolumeMb: {
            type: 'number',
            description: 'Data processed, in MB',
            nullable: true,
          },
          loadVolumeMb: {
            type: 'number',
            description: 'Data loaded into the destination, in MB',
            nullable: true,
          },
        },
      },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
