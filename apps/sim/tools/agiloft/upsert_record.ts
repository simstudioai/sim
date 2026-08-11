import type { AgiloftUpsertRecordParams, AgiloftUpsertRecordResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftUpsertRecordTool: ToolConfig<
  AgiloftUpsertRecordParams,
  AgiloftUpsertRecordResponse
> = {
  id: 'agiloft_upsert_record',
  name: 'Agiloft Upsert Record',
  description:
    'Create an Agiloft record, or update it when a record already matches the given fields.',
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
      description: 'Table name (e.g., "contracts", "contacts.employees")',
    },
    match: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Field used to find an existing record (e.g., "ext_id"). Pick something that identifies a record uniquely — if more than one record matches, Agiloft writes nothing and returns a conflict.',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Queue the write instead of waiting for it. Returns a callback ID instead of a record ID; pass that to Async Status to poll the result.',
    },
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Field values as a JSON object. On create these populate the new record; on update only the supplied fields change.',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/upsert_record',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      match: params.match,
      data: params.data,
      async: params.async,
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
    id: { type: 'string', description: 'ID of the created or updated record' },
    created: {
      type: 'boolean',
      description: 'True when a new record was created, false when an existing one was updated',
    },
    callbackId: {
      type: 'string',
      description: 'Returned for a queued upsert; pass it to Async Status to poll the result',
      optional: true,
    },
  },
}
