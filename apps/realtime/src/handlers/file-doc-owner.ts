import type { FileDocOwner, FileDocTarget } from '@sim/realtime-protocol/file-doc-target'
import {
  fetchFileDocPersist,
  fetchFileDocSeed,
  fetchProjectFileDocPersist,
  fetchProjectFileDocSeed,
  type PersistResult,
} from '@/handlers/file-doc-app'
import type { FileDocEditor } from '@/handlers/file-doc-store'

interface PersistenceActor {
  userId: string
  connectionId: string | null
}

interface FileDocOwnerAdapter {
  requiresCurrentActor: boolean
  tracksLifecycle: boolean
  seed(
    target: FileDocTarget,
    actor?: FileDocEditor
  ): Promise<{ update: Uint8Array; version: number } | null>
  persist(
    target: FileDocTarget,
    actor: PersistenceActor,
    state: Uint8Array,
    version?: number
  ): Promise<PersistResult>
}

function requireOwner(target: FileDocTarget, entityType: FileDocOwner['entityType']): string {
  if (!target.owner || target.owner.entityType !== entityType || !target.owner.entityId)
    throw new Error('Document has no canonical owner context')
  return target.owner.entityId
}

function projectRequest(target: FileDocTarget, actor?: PersistenceActor) {
  if (!actor?.userId || !actor.connectionId)
    throw new Error('Document callback requires an authenticated editor')
  return {
    projectId: requireOwner(target, 'project'),
    fileId: target.fileId,
    userId: actor.userId,
    connectionId: actor.connectionId,
  }
}

const OWNER_ADAPTERS: Record<FileDocOwner['entityType'], FileDocOwnerAdapter> = {
  workspace: {
    requiresCurrentActor: false,
    tracksLifecycle: false,
    seed: (target) => fetchFileDocSeed(requireOwner(target, 'workspace'), target.fileId),
    persist: (target, actor, state, version) =>
      fetchFileDocPersist(
        requireOwner(target, 'workspace'),
        target.fileId,
        actor.userId,
        state,
        version
      ),
  },
  project: {
    requiresCurrentActor: true,
    tracksLifecycle: true,
    seed: (target, actor) => fetchProjectFileDocSeed(projectRequest(target, actor)),
    persist: (target, actor, state, version) =>
      fetchProjectFileDocPersist(projectRequest(target, actor), state, version),
  },
}

/** Only registered scopes can use callbacks; legacy workspace addresses resolve their owner at join. */
export function fileDocOwnerAdapter(owner?: FileDocOwner): FileDocOwnerAdapter {
  const type = owner?.entityType ?? 'workspace'
  if (!Object.hasOwn(OWNER_ADAPTERS, type)) throw new Error('Unsupported document owner')
  return OWNER_ADAPTERS[type]
}
