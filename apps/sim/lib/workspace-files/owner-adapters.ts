import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { FileOwner } from '@/lib/workspace-files/ownership'

/** Each authority boundary registers only the owners whose policy it implements. */
export type FileOwnerAdapters<Adapter> = Readonly<Partial<Record<FileOwner['entityType'], Adapter>>>

/** Owner identity never enables an operation without an explicitly registered adapter. */
export function requireFileOwnerAdapter<Adapter>(
  adapters: FileOwnerAdapters<Adapter>,
  owner: FileOwner
): Adapter {
  if (
    typeof owner.entityId !== 'string' ||
    !owner.entityId ||
    owner.entityId !== owner.entityId.trim() ||
    owner.entityId.length > 200 ||
    !Object.hasOwn(adapters, owner.entityType)
  ) {
    throw new OrchestrationError('not_found', 'File owner is unavailable')
  }
  const adapter = adapters[owner.entityType]
  if (!adapter) throw new OrchestrationError('not_found', 'File owner is unavailable')
  return adapter
}
