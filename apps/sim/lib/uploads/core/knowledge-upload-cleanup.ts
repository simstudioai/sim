import { db } from '@sim/db'
import { document, workspaceFiles } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import {
  deleteProviderObjectVersion,
  headProviderObject,
  uploadStorageProvider,
} from '@/lib/uploads/upload-session/provider'

/**
 * Compensates a failed cache metadata insert only while no canonical binding
 * survived and the provider object still belongs to this create-only upload.
 */
export async function cleanupUnboundKnowledgeUpload(key: string, uploadId: string): Promise<void> {
  const [bindings, documents] = await Promise.all([
    db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.key, key))
      .limit(1),
    db.select({ id: document.id }).from(document).where(eq(document.storageKey, key)).limit(1),
  ])
  if (bindings.length > 0 || documents.length > 0) return

  const provider = uploadStorageProvider()
  const object = await headProviderObject({ provider, key, context: 'knowledge-base' })
  if (!object || object.uploadId !== uploadId) return
  await deleteProviderObjectVersion({
    provider,
    key,
    context: 'knowledge-base',
    version: object.version,
  })
}
