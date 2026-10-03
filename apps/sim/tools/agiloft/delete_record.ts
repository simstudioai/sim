import type { AgiloftDeleteRecordParams, AgiloftDeleteResponse } from '@/tools/agiloft/types'
import type { InternalToolConfig } from '@/tools/types'

export const agiloftDeleteRecordTool: InternalToolConfig<
  AgiloftDeleteRecordParams,
  AgiloftDeleteResponse
> = {
  id: 'agiloft_delete_record',
  name: 'Agiloft Delete Record',
  description: 'Delete a record from an Agiloft table.',
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
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the record to delete',
    },
    substituteIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated IDs of records that adopt the dependants of the deleted record. Read only when the delete rule is REPLACE_WITH_ANOTHER.',
    },
    deleteRule: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How to treat records that depend on this one: ERROR_IF_DEPENDANTS (default — fails rather than cascading), APPLY_DELETE_WHERE_POSSIBLE, DELETE_WHERE_POSSIBLE_OTHERWISE_UNLINK, APPLY_UNLINK, UNLINK_WHERE_POSSIBLE_OTHERWISE_DELETE, or REPLACE_WITH_ANOTHER',
    },
  },

  operation: {
    input: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      recordId: params.recordId,
      deleteRule: params.deleteRule,
      substituteIds: params.substituteIds,
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
      description: 'ID of the deleted record',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the record was successfully deleted',
    },
  },
}
