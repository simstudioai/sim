import type { AgiloftLockRecordParams, AgiloftLockResponse } from '@/tools/agiloft/types'
import { buildLockRecordUrl, executeAgiloftRequest, getLockHttpMethod } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftLockRecordTool: ToolConfig<AgiloftLockRecordParams, AgiloftLockResponse> = {
  id: 'agiloft_lock_record',
  name: 'Agiloft Lock Record',
  description: 'Lock, unlock, or check the lock status of an Agiloft record.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name (e.g., "contracts")',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the record to lock, unlock, or check',
    },
    lockAction: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "lock", "unlock", or "check"',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftLockResponse>(
      params,
      (base) => ({
        url: buildLockRecordUrl(base, params),
        method: getLockHttpMethod(params.lockAction),
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: {
              id: params.recordId?.trim() ?? '',
              lockStatus: 'UNKNOWN',
              lockedBy: null,
              lockExpiresInMinutes: null,
            },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = await response.json()
        const result = data.result ?? data

        return {
          success: data.success !== false,
          output: {
            id: String(result.id ?? params.recordId?.trim() ?? ''),
            lockStatus: result.lock_status ?? result.lockStatus ?? 'UNKNOWN',
            lockedBy: result.locked_by ?? result.lockedBy ?? null,
            lockExpiresInMinutes:
              result.lock_expires_in_minutes ?? result.lockExpiresInMinutes ?? null,
          },
        }
      }
    )
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Record ID',
    },
    lockStatus: {
      type: 'string',
      description: 'Lock status (e.g., "LOCKED", "UNLOCKED")',
    },
    lockedBy: {
      type: 'string',
      description: 'Username of the user who locked the record',
      optional: true,
    },
    lockExpiresInMinutes: {
      type: 'number',
      description: 'Minutes until the lock expires',
      optional: true,
    },
  },
}
