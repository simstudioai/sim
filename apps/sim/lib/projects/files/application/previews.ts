import type { Principal } from '@sim/auth/principal'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
  mapFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { getBoundWorkspaceFileSecretProvenanceByMetadata } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

interface InlineInput {
  projectId: string
  key?: string
  referenceFileId?: string
}

const resolveInlineRecord = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readInline,
  async execute({
    input,
    context,
    tx,
  }: {
    input: InlineInput
    context: ProjectFileAuthorizationContext
    tx: DbTransaction
  }) {
    if (Boolean(input.key) === Boolean(input.referenceFileId))
      throw new OrchestrationError('validation', 'Provide exactly one file reference')
    const [file] = await tx
      .select()
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition(context.owner),
          isNull(workspaceFiles.deletedAt),
          input.referenceFileId
            ? eq(workspaceFiles.id, input.referenceFileId)
            : eq(workspaceFiles.key, input.key ?? '')
        )
      )
      .for('share')
      .limit(1)
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return file
  },
})

/** Resolves a private object under its Project before reading, then fences its current head again. */
export const readProjectInlineFile = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readInline,
  async prepare({ principal, input }: { principal: Principal; input: InlineInput }) {
    const file = await resolveInlineRecord.execute({ principal, input })
    const content = await downloadFile({
      key: file.key,
      context: 'project',
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    return { file, content }
  },
  async execute({ context, tx, prepared }) {
    if (!prepared) throw new Error('Inline file bytes are unavailable')
    const [file] = await tx
      .select()
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition(context.owner),
          eq(workspaceFiles.id, prepared.file.id),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .for('share')
      .limit(1)
    if (
      !file ||
      file.key !== prepared.file.key ||
      file.contentUpdatedAt.getTime() !== prepared.file.contentUpdatedAt.getTime()
    )
      throw new OrchestrationError('conflict', 'File changed while preparing its preview')
    const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])
    const folders = file.folderId ? await listFileFolders(context.owner, { scope: 'all' }, tx) : []
    return {
      file: mapFileRecord(file, context.owner, buildWorkspaceFileFolderPathMap(folders)),
      content: prepared.content,
      secretProvenance: evidence.get(file.id),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})

interface CsvPreviewInput extends ProjectFileTarget {
  fileId: string
  key: string
  signal?: AbortSignal
}

/** Reads only the bounded CSV slice and rejects head changes before exposing its rows. */
export const readProjectFileCsvPreview = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readContent,
  async prepare({
    input,
    context,
  }: {
    input: CsvPreviewInput
    context: ProjectFileAuthorizationContext
  }) {
    const file = context.file
    if (!file || file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
    return {
      file,
      slice: await getCsvPreviewSlice({ key: file.key, context: 'project', signal: input.signal }),
    }
  },
  async execute({ input, context, tx, prepared }) {
    const file = context.file
    if (!file || file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
    if (!prepared || file.contentUpdatedAt.getTime() !== prepared.file.contentUpdatedAt.getTime())
      throw new OrchestrationError('conflict', 'File changed while preparing its preview')
    const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])
    return { success: true as const, ...prepared.slice, secretProvenance: evidence.get(file.id) }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})
