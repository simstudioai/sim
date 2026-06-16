import type { AgiloftLockRecordParams, AgiloftLockResponse } from '@/tools/agiloft/types'
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
    url: () => '/api/tools/agiloft/lock_record',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      recordId: params.recordId,
      lockAction: params.lockAction,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output,
      ...(data.error ? { error: data.error } : {}),
    }
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
