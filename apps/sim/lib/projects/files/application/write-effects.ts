import type { WorkspaceFileRow } from '@sim/db/schema'
import { prepareFileAccountingInTx } from '@/lib/billing/storage/accounting'
import type { ProjectStorageBillingContext } from '@/lib/billing/storage/context'
import { maybeNotifyStorageLimitForBillingContext } from '@/lib/billing/storage/tracking'
import type { DbTransaction } from '@/lib/db/types'
import type { ProjectFileAuthorizationContext } from '@/lib/projects/files/application/authorization'
import {
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { mapFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { finishFileContentEffects } from '@/lib/uploads/server/content-effects'

interface CommittedWriteEffects {
  billing: ProjectStorageBillingContext
  usage: number
  delta: number
  cleanupIds: string[]
  liveDocEventId?: string
  cleanupReason?: string
}

const committedWriteEffects = new WeakMap<object, CommittedWriteEffects>()

/** Attaches private postcommit work to an authoritative result without adding wire fields. */
export function recordProjectFileWriteEffects(result: object, effects: CommittedWriteEffects) {
  committedWriteEffects.set(result, effects)
}

/** Applies notifications and durable cleanup only after the metadata transaction commits. */
export async function finishProjectFileWrite(result: object) {
  const effects = committedWriteEffects.get(result)
  if (!effects) throw new Error('Committed file effects are unavailable')
  committedWriteEffects.delete(result)
  await maybeNotifyStorageLimitForBillingContext(effects.billing, effects.usage, effects.delta < 0)
  await finishFileContentEffects(effects, {
    projectId: effects.billing.projectId,
    reason: effects.cleanupReason ?? 'released version',
  })
}

/** Projects owner-aware metadata using the caller's authorized transaction. */
export async function mapProjectFileResult(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  file: WorkspaceFileRow
) {
  const folders = file.folderId ? await listFileFolders(context.owner, { scope: 'all' }, tx) : []
  return {
    file: {
      ...mapFileRecord(file, context.owner, buildWorkspaceFileFolderPathMap(folders)),
      contentUpdatedAt: file.contentUpdatedAt,
    },
    capabilities: { canRead: true as const, canWrite: context.canWrite },
  }
}

/** Locks the canonical Project payer before content, directory, and history mutation locks. */
export async function prepareProjectFileAccounting(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext
) {
  return prepareFileAccountingInTx(tx, { entityType: 'project', entityId: context.projectId })
}
