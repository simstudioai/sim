import { customTools } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { assertValidCustomToolDeclaration } from '@/lib/custom-tools/schema'
import type { DbOrTx } from '@/lib/db/types'
import { coerceObjectArray } from '@/lib/workflows/persistence/remap-internal-ids'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface ImportedInlineTool {
  id: string
  title: string
  schema: Record<string, unknown>
  code: string
}

/** Imported declarations are insert-only and receive new destination identities. */
export function prepareImportedInlineTools(state: WorkflowState): ImportedInlineTool[] {
  const byTitle = new Map<string, ImportedInlineTool>()
  for (const block of Object.values(state.blocks))
    for (const field of Object.values(block.subBlocks)) {
      if (field.type !== 'tool-input') continue
      const { array, wasString } = coerceObjectArray(field.value)
      if (!array) continue
      for (const tool of array) {
        if (!isRecordLike(tool) || tool.type !== 'custom-tool' || (!tool.code && !tool.schema))
          continue
        if (
          typeof tool.title !== 'string' ||
          !tool.title.trim() ||
          tool.title.length > 255 ||
          typeof tool.code !== 'string' ||
          tool.code.length > 1024 * 1024 ||
          !isRecordLike(tool.schema)
        ) {
          throw new OrchestrationError('validation', 'Invalid inline custom tool declaration')
        }
        assertValidCustomToolDeclaration(tool.schema)
        const existing = byTitle.get(tool.title)
        if (
          existing &&
          (existing.code !== tool.code ||
            JSON.stringify(existing.schema) !== JSON.stringify(tool.schema))
        ) {
          throw new OrchestrationError(
            'validation',
            'Conflicting inline custom tools share a title'
          )
        }
        const imported = existing ?? {
          id: generateId(),
          title: tool.title,
          schema: tool.schema,
          code: tool.code,
        }
        byTitle.set(imported.title, imported)
        tool.customToolId = imported.id
        tool.toolId = imported.id
      }
      field.value = (wasString ? JSON.stringify(array) : array) as typeof field.value
    }
  if (byTitle.size > 2000)
    throw new OrchestrationError('payload_too_large', 'Too many inline custom tools')
  return [...byTitle.values()]
}

export async function assertImportedInlineToolTitlesAvailable(
  tx: DbOrTx,
  workspaceId: string,
  tools: ImportedInlineTool[]
): Promise<void> {
  if (!tools.length) return
  const [duplicate] = await tx
    .select({ title: customTools.title })
    .from(customTools)
    .where(
      and(
        eq(customTools.workspaceId, workspaceId),
        inArray(
          customTools.title,
          tools.map((tool) => tool.title)
        )
      )
    )
    .limit(1)
  if (duplicate)
    throw new OrchestrationError(
      'conflict',
      `An inline custom tool named "${duplicate.title}" already exists in the destination workspace`
    )
}

export async function insertImportedInlineTools(
  tx: DbOrTx,
  workspaceId: string,
  userId: string,
  tools: ImportedInlineTool[]
): Promise<void> {
  await assertImportedInlineToolTitlesAvailable(tx, workspaceId, tools)
  for (let offset = 0; offset < tools.length; offset += 100) {
    await tx
      .insert(customTools)
      .values(tools.slice(offset, offset + 100).map((tool) => ({ ...tool, workspaceId, userId })))
  }
}
