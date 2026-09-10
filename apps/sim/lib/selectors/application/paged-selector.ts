import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { selectorOperations } from '@/lib/selectors/application/operations'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import type { SafeSelectorOption, SelectorContext } from '@/lib/selectors/types'
import { workflowOperationFingerprint } from '@/lib/workspaces/operations/receipts'

export interface ListSelectorInput {
  workspaceId: string
  selectorKey: ServerSelectorKey
  context: SelectorContext
  search?: string
  cursor?: string
  limit: number
  signal?: AbortSignal
}

export interface SelectorPage {
  items: SafeSelectorOption[]
  nextCursor: string | null
  truncated: boolean
}

const cursorSchema = z
  .object({
    version: z.literal(1),
    providerCursor: z
      .string()
      .max(16 * 1024)
      .optional(),
    offset: z.number().int().min(0).max(MAX_SELECTOR_OPTIONS),
    pageHash: z.string().length(64).optional(),
    scopeHash: z.string().length(64),
  })
  .strict()

/** Pages a bounded provider page without retaining credential context or provider results. */
export const listSelector: OperationUseCase<
  typeof selectorOperations.execute,
  ListSelectorInput,
  SelectorPage
> = {
  operation: selectorOperations.execute,
  async execute({ principal, input, ...rest }) {
    const scopeHash = workflowOperationFingerprint({
      workspaceId: input.workspaceId,
      selectorKey: input.selectorKey,
      context: input.context,
      search: input.search,
    })
    let cursor: z.output<typeof cursorSchema> = { version: 1, offset: 0, scopeHash }
    if (input.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
        )
      } catch {
        throw new OrchestrationError('validation', 'Invalid selector cursor')
      }
      if (cursor.scopeHash !== scopeHash)
        throw new OrchestrationError(
          'validation',
          'Selector cursor does not match the requested scope or dependencies'
        )
    }
    const result = await executeSelector.execute({
      ...rest,
      principal,
      input: {
        selectorKey: input.selectorKey,
        context: input.context,
        scope: { kind: 'workspace', workspaceId: input.workspaceId },
        request: { kind: 'list', search: input.search, cursor: cursor.providerCursor },
        signal: input.signal,
      },
    })
    if (result.kind !== 'list')
      throw new OrchestrationError('internal', 'Selector returned an invalid page')
    const serialized = JSON.stringify(result.items)
    if (Buffer.byteLength(serialized, 'utf8') > 8 * 1024 * 1024)
      throw new OrchestrationError(
        'payload_too_large',
        'Selector page exceeds 8 MiB; narrow the search'
      )
    const pageHash = createHash('sha256').update(serialized).digest('hex')
    if (cursor.pageHash && cursor.pageHash !== pageHash) {
      throw new OrchestrationError(
        'conflict',
        'Selector options changed; restart discovery without a cursor'
      )
    }
    const end = cursor.offset + input.limit
    const next =
      end < result.items.length
        ? { version: 1, providerCursor: cursor.providerCursor, offset: end, pageHash, scopeHash }
        : result.nextCursor
          ? { version: 1, providerCursor: result.nextCursor, offset: 0, scopeHash }
          : null
    return {
      items: result.items.slice(cursor.offset, end),
      nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,
      truncated: result.truncated ?? false,
    }
  },
}
