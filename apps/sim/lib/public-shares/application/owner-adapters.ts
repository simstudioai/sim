import { project, type WorkspaceFileRow, workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject, lockWorkspaceProject } from '@/lib/projects/membership'
import { requireProjectFileApiEnabled } from '@/lib/projects/rollout.server'
import { type E2BDocFormat, resolveServableDoc } from '@/lib/uploads/documents/compile'
import { loadCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner, FileOwner } from '@/lib/workspace-files/ownership'

interface PublicFileOwnerContext {
  owner: EditableFileOwner
  organizationId: string | null
  displayName: string
  workspaceId: string | null
}
interface DocumentRead {
  owner: EditableFileOwner
  source: Buffer
  sourceMime: string
  fileName: string
  format: E2BDocFormat
  dependencies: readonly WorkspaceFileRow[]
}
interface PublicFileOwnerAdapter {
  load(tx: DbTransaction, entityId: string): Promise<PublicFileOwnerContext>
  storageContext: 'workspace' | 'project'
  pageOptions(entityId: string): { workspaceId?: string; projectId?: string }
  readCompiled(input: DocumentRead): Promise<{ buffer: Buffer; contentType: string }>
}

const adapters: FileOwnerAdapters<PublicFileOwnerAdapter> = {
  workspace: {
    async load(tx, entityId) {
      await lockWorkspaceProject(tx, entityId)
      const [row] = await tx.select().from(workspace).where(eq(workspace.id, entityId)).for('share')
      if (!row || row.archivedAt) throw new OrchestrationError('not_found', 'File share not found')
      return {
        owner: { entityType: 'workspace', entityId },
        organizationId: row.organizationId,
        displayName: row.name,
        workspaceId: entityId,
      }
    },
    storageContext: 'workspace',
    pageOptions: (workspaceId) => ({ workspaceId }),
    async readCompiled({ owner, source, sourceMime, fileName }) {
      const artifact = await resolveServableDoc(owner.entityId, source, fileName, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        sourceMime,
      })
      if (artifact.kind !== 'artifact')
        throw new OrchestrationError(
          'conflict',
          'This document is still being prepared. Please try again shortly.'
        )
      return artifact
    },
  },
  project: {
    async load(tx, entityId) {
      await requireProjectFileApiEnabled()
      await lockProject(tx, entityId)
      const [row] = await tx.select().from(project).where(eq(project.id, entityId)).for('share')
      if (!row || row.archivedAt) throw new OrchestrationError('not_found', 'File share not found')
      return {
        owner: { entityType: 'project', entityId },
        organizationId: row.organizationId,
        displayName: row.name,
        workspaceId: null,
      }
    },
    storageContext: 'project',
    pageOptions: (projectId) => ({ projectId }),
    async readCompiled({ owner, source, format, dependencies }) {
      const buffer = await loadCompiledDoc(
        owner,
        source.toString('utf8'),
        format.ext,
        fileDocumentInputIdentity(owner, dependencies),
        { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
      )
      if (!buffer)
        throw new OrchestrationError(
          'conflict',
          'This document is still being prepared. Please try again shortly.'
        )
      return { buffer, contentType: format.contentType }
    },
  },
}

/** Bearer policy requires a live canonical owner; it never substitutes a member or creator identity. */
export async function loadPublicFileOwner(tx: DbTransaction, owner: FileOwner) {
  const adapter = requireFileOwnerAdapter(adapters, owner)
  return { ...(await adapter.load(tx, owner.entityId)), adapter }
}
