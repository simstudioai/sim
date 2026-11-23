import type { ToolConfig } from '@/tools/types'

interface StripeListCursors {
  starting_after?: string
  ending_before?: string
}

/** `starting_after`/`ending_before` param definitions for a Stripe list tool over `objectName`. */
export function listCursorParams(
  objectName: string
): Record<keyof StripeListCursors, ToolConfig['params'][string]> {
  return {
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Next-page cursor: last ${objectName} ID from the previous page. Do not combine with ending_before.`,
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Previous-page cursor: first ${objectName} ID from the current page. Do not combine with starting_after.`,
    },
  }
}

/** Appends a list tool's cursors to `url`; Stripe rejects a request that sets both. */
export function appendListCursors(url: URL, params: StripeListCursors): void {
  if (params.starting_after && params.ending_before) {
    throw new Error('Provide either starting_after or ending_before, not both')
  }
  if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
  if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
}
