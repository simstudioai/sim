import type { AgiloftSavedSearchParams, AgiloftSavedSearchResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Retired operation, kept registered so workflows saved while it was offered
 * still resolve a tool instead of failing with "Tool not found".
 *
 * `EWSavedSearch` appears in Agiloft's Scope Parameter operation list, so the
 * endpoint exists, but it has no documentation page — neither its URL
 * parameters nor its response shape can be verified. The previous
 * implementation guessed both and could only ever report an empty list, which
 * reads as "this table has no saved searches". Running a saved search is now
 * supported for real through the Search Records operation's Saved Search
 * field, so this fails fast and points there rather than issuing a request
 * whose behavior nobody can predict.
 */
export const agiloftSavedSearchTool: ToolConfig<
  AgiloftSavedSearchParams,
  AgiloftSavedSearchResponse
> = {
  id: 'agiloft_saved_search',
  name: 'Agiloft Saved Search (retired)',
  description:
    'Retired. Agiloft does not document an endpoint for listing saved searches — use the Search Records operation and set its Saved Search field instead.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Agiloft instance URL',
    },
    knowledgeBase: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Table name',
    },
  },

  /** Fails without a network call — there is no endpoint we can correctly call. */
  directExecution: async () => ({
    success: false,
    output: { searches: [] },
    error:
      'The Agiloft "Saved Search" operation has been retired because Agiloft does not document an endpoint for listing saved searches. Switch this block to the "Search Records" operation and enter the saved search name in its Saved Search field.',
  }),

  request: {
    url: () => '/api/tools/agiloft/search_records',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: () => ({}),
  },

  transformResponse: async () => ({
    success: false,
    output: { searches: [] },
    error: 'The Agiloft "Saved Search" operation has been retired.',
  }),

  outputs: {
    searches: {
      type: 'array',
      description: 'Always empty; this operation is retired',
      items: { type: 'object' },
    },
  },
}
