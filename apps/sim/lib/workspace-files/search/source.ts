import { db } from '@sim/db'
import type { WorkspaceFileRow } from '@sim/db/schema'
import { workspaceFiles } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  collectReferencedFileIds,
  getDocumentSourceLanguage,
  getE2BDocFormat,
  isCompiledDocumentBuffer,
} from '@/lib/uploads/documents'
import { fileDocumentCacheIdentity } from '@/lib/uploads/documents/compile'
import { DocCompileUserError } from '@/lib/uploads/documents/compile-error'
import { compiledArtifactKey, loadCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import {
  FILE_SEARCH_MAX_DEPENDENCIES,
  FILE_SEARCH_MAX_SOURCE_BYTES,
} from '@/lib/workspace-files/search/constants'
import type { IndexableBytes } from '@/lib/workspace-files/search/extract'
import { FileSearchExclusionError } from '@/lib/workspace-files/search/index-plan'
import type { FileSearchRevision } from '@/lib/workspace-files/search/index-state'
import {
  fileSearchInputCondition,
  resolveFileSearchOwner,
  searchableFileCondition,
} from '@/lib/workspace-files/search/scope'

export interface FileSearchDependencyIdentity {
  fileId: string
  key: string
  sourceContentUpdatedAt: Date
}

/** System indexers read current stored inputs and caches; they never execute generation source. */
export async function loadFileSearchSource(
  revision: FileSearchRevision,
  signal: AbortSignal
): Promise<{
  file: WorkspaceFileRow
  bytes: IndexableBytes
  dependencies: FileSearchDependencyIdentity[]
  artifactKey?: string
} | null> {
  const owner = resolveFileSearchOwner(revision)
  signal.throwIfAborted()
  const [file] = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        searchableFileCondition(owner),
        eq(workspaceFiles.id, revision.fileId),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.contentUpdatedAt, revision.sourceContentUpdatedAt)
      )
    )
    .limit(1)
  if (!file) return null
  if (file.sizeBytes !== null)
    assertKnownSizeWithinLimit(file.sizeBytes, FILE_SEARCH_MAX_SOURCE_BYTES, 'search source')
  const raw = await downloadFile({
    key: file.key,
    context: owner.entityType,
    maxBytes: FILE_SEARCH_MAX_SOURCE_BYTES,
    signal,
  })
  const format = await getE2BDocFormat(file.originalName)
  if (!format || isCompiledDocumentBuffer(file.originalName, raw))
    return { file, bytes: { buffer: raw, kind: 'stored' }, dependencies: [] }
  const source = raw.toString('utf8')
  let ids: string[]
  try {
    ids = [
      ...collectReferencedFileIds(
        source,
        getDocumentSourceLanguage(source, format, file.contentType)
      ),
    ]
  } catch (error) {
    // Unparseable source still has searchable text; it just names no inputs.
    if (error instanceof DocCompileUserError)
      return { file, bytes: { buffer: raw, kind: 'source' }, dependencies: [] }
    throw error
  }
  if (ids.length > FILE_SEARCH_MAX_DEPENDENCIES)
    throw new FileSearchExclusionError('incomplete_extraction')
  const inputs =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(workspaceFiles)
          .where(
            and(
              fileSearchInputCondition(owner),
              inArray(workspaceFiles.id, ids),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .orderBy(asc(workspaceFiles.id))
  if (inputs.length !== ids.length) throw new FileSearchExclusionError('incomplete_extraction')
  signal.throwIfAborted()
  const inputIdentity = fileDocumentInputIdentity(owner, inputs)
  const cacheIdentity =
    owner.entityType === 'project'
      ? fileDocumentCacheIdentity(source, format, file.contentType, inputIdentity)
      : inputIdentity
  const artifact = await loadCompiledDoc(owner, source, format.ext, cacheIdentity, {
    maxBytes: FILE_SEARCH_MAX_SOURCE_BYTES,
    signal,
  })
  return {
    file,
    bytes: artifact ? { buffer: artifact, kind: 'artifact' } : { buffer: raw, kind: 'source' },
    ...(artifact
      ? {
          artifactKey: compiledArtifactKey(owner, source, format.ext, cacheIdentity),
        }
      : {}),
    dependencies: inputs.map((input) => ({
      fileId: input.id,
      key: input.key,
      sourceContentUpdatedAt: input.contentUpdatedAt,
    })),
  }
}
