import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import {
  MAX_INLINE_MOUNT_FILE_BYTES,
  MAX_INLINE_MOUNT_TOTAL_BYTES,
  MAX_TOTAL_URL_BYTES,
  MOUNT_URL_TTL_SECONDS,
  type SandboxMountBudget,
} from '@/lib/function-execution/sandbox-mounts'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableInWorkspace,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { resolveTableByVfsName } from '@/lib/table/application/table-vfs'
import { getTableSnapshotModelMountSafety } from '@/lib/table/rows/secret-provenance'
import {
  getOrCreateTableSnapshot,
  SNAPSHOT_MAX_BYTES,
  TableSnapshotTooLargeError,
} from '@/lib/table/snapshot-cache'
import {
  downloadFile,
  generatePresignedDownloadUrl,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { decodeVfsPathSegments } from '@/lib/vfs/path'

export interface ReadTableSnapshotInput {
  workspaceId: string
  reference: string
  sandboxPath?: string
  budget: SandboxMountBudget
  signal?: AbortSignal
}

export interface ReadTableSnapshotResult {
  mount: SandboxFile
  budget: SandboxMountBudget
  unsafeProvenance: boolean
}

/** Resolves and reads one CSV snapshot under the caller's current workspace authority. */
export const readTableSnapshot = defineAuthorizedTableUseCase({
  operation: tableOperations.readSnapshot,
  resolveContext: ({ input }: { input: ReadTableSnapshotInput }) => {
    input.signal?.throwIfAborted()
    return resolveTableWorkspaceContext(input.workspaceId)
  },
  async execute({ input, context }): Promise<ReadTableSnapshotResult> {
    input.signal?.throwIfAborted()
    const reference = input.reference.replace(/^\/+/, '')
    const segments = reference.startsWith('tables/')
      ? decodeVfsPathSegments(reference).slice(1)
      : undefined
    if (segments?.at(-1) === 'meta.json') segments.pop()
    const table = segments
      ? await resolveTableByVfsName(context.workspaceId, segments.at(-1) ?? '', segments)
      : (await resolveActiveTableInWorkspace(reference, context)).table
    input.signal?.throwIfAborted()
    const snapshot = await getOrCreateTableSnapshot(table, 'copilot-fn-exec').catch((error) => {
      if (error instanceof TableSnapshotTooLargeError)
        throw new OrchestrationError('validation', error.message)
      throw error
    })
    input.signal?.throwIfAborted()
    const safety = await getTableSnapshotModelMountSafety({
      tableId: table.id,
      workspaceId: context.workspaceId,
      rowsVersion: snapshot.version,
    })
    input.signal?.throwIfAborted()
    if (safety === 'stale') {
      throw new OrchestrationError(
        'conflict',
        `Input table "${input.reference}" changed while preparing its snapshot. Retry.`
      )
    }
    const budget = { ...input.budget }
    const path = input.sandboxPath ?? `/home/user/tables/${table.id}.csv`
    let mount: SandboxFile
    if (hasCloudStorage()) {
      if (snapshot.size > SNAPSHOT_MAX_BYTES || budget.url + snapshot.size > MAX_TOTAL_URL_BYTES) {
        throw new OrchestrationError(
          'validation',
          `Input table "${input.reference}" exceeds the ${SNAPSHOT_MAX_BYTES / 1024 / 1024}MB table or ${MAX_TOTAL_URL_BYTES / 1024 / 1024 / 1024}GB total mount limit. Mount fewer or smaller inputs.`
        )
      }
      const url = await generatePresignedDownloadUrl(
        snapshot.key,
        'execution',
        MOUNT_URL_TTL_SECONDS
      )
      mount = { type: 'url', path, url, maxBytes: SNAPSHOT_MAX_BYTES }
      budget.url += snapshot.size
    } else {
      const maxBytes = Math.min(
        MAX_INLINE_MOUNT_FILE_BYTES,
        Math.max(0, MAX_INLINE_MOUNT_TOTAL_BYTES - budget.buffered)
      )
      if (snapshot.size > maxBytes) {
        throw new OrchestrationError(
          'validation',
          `Input table "${input.reference}" exceeds the ${MAX_INLINE_MOUNT_FILE_BYTES / 1024 / 1024}MB file or ${MAX_INLINE_MOUNT_TOTAL_BYTES / 1024 / 1024}MB total mount limit. Mount fewer or smaller inputs.`
        )
      }
      const buffer = await downloadFile({ key: snapshot.key, context: 'execution', maxBytes })
      mount = { path, content: buffer.toString('utf8') }
      budget.buffered += buffer.length
    }
    input.signal?.throwIfAborted()
    return { mount, budget, unsafeProvenance: safety === 'unsafe-provenance' }
  },
})
