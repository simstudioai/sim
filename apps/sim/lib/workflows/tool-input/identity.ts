import { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import type { BlockConfig } from '@/blocks/types'

/** Shared by execution and inspection; attachment labels never select registry operations. */
export function resolveBlockToolId(
  definition: Pick<BlockConfig, 'tools' | 'subBlocks'>,
  params: Record<string, unknown>,
  operation?: string
): string | null {
  const { access, config } = definition.tools
  if (access.length <= 1) return access[0] || null
  const hasOperationSelector = definition.subBlocks.some(
    (field) => field.id === OPERATION_SUBBLOCK_ID
  )
  if (
    config?.tool &&
    (operation || params.operation || (!hasOperationSelector && Object.keys(params).length > 0))
  ) {
    const id = config.tool({ ...params, ...(operation ? { operation } : {}) })
    return access.includes(id) ? id : null
  }
  return access[0] || null
}
