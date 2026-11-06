import type { Principal } from '@sim/auth/principal'
import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { requireAdmittedContent } from '@/lib/core/application/content-delivery'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import type { DbTransaction } from '@/lib/db/types'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

interface InlineInput {
  projectId: string
  key?: string
  referenceFileId?: string
  view?: 'opaque' | 'excerpt'
}

const resolveInlineRecord = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.readInline,
  InlineInput,
  {
    file: WorkspaceFileRow
    organizationId: string | null
    secretProvenance: WorkspaceFileSecretProvenance | undefined
  }
>({
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
    const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])
    return {
      file,
      organizationId: context.organizationId,
      secretProvenance: evidence.get(file.id),
    }
  },
  afterSuccess: ({ principal, input, result }) =>
    requireAdmittedContent(principal, {
      kind: 'workspace-file',
      id: result.file.id,
      provenance: result.secretProvenance ?? { status: 'unknown' },
      view: input.view ?? 'opaque',
    }),
})

type ResolveInlineArgs = Parameters<typeof resolveInlineRecord.execute>[0]

/**
 * Streams a private object resolved under its Project, then fences its current head after storage
 * opens. A key request names the exact immutable object it streamed, so it is content-addressed.
 */
export const readProjectInlineFile = {
  operation: resolveInlineRecord.operation,
  delegationAudience: resolveInlineRecord.delegationAudience,
  /** HEAD resolves the canonical image without fetching its bytes. */
  async authorize(args: ResolveInlineArgs) {
    await resolveInlineRecord.execute(args)
  },
  async execute(args: ResolveInlineArgs) {
    const snapshot = await resolveInlineRecord.execute(args)
    const stream = nodeReadableToWebStream(
      await runWithOutboundOrganization(snapshot.organizationId, () =>
        downloadFileStream({ key: snapshot.file.key, context: 'project' })
      )
    )
    try {
      const { file, secretProvenance } = await resolveInlineRecord.execute({
        ...args,
        input: { projectId: args.input.projectId, referenceFileId: snapshot.file.id },
      })
      if (
        file.key !== snapshot.file.key ||
        file.contentUpdatedAt.getTime() !== snapshot.file.contentUpdatedAt.getTime()
      )
        throw new OrchestrationError('conflict', 'File changed while preparing its preview')
      await reportWorkspaceFileDelivery(secretProvenance, file.id)
      return {
        file: { id: file.id, name: file.originalName, type: file.contentType },
        stream,
        contentLength: getWorkspaceFileSize(file),
        contentAddressed: args.input.key !== undefined,
      }
    } catch (error) {
      await stream.cancel(error).catch(() => undefined)
      throw error
    }
  },
}

interface CsvPreviewInput extends ProjectFileTarget {
  fileId: string
  key: string
  signal?: AbortSignal
}

/** Reads only the bounded CSV slice and rejects head changes before exposing its rows. */
export const readProjectFileCsvPreview = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.readContent,
  async prepareFromSnapshot({
    input,
    principal,
  }: {
    principal: Principal
    input: CsvPreviewInput
  }) {
    const { file, organizationId } = await resolveInlineRecord.execute({
      principal,
      input: { projectId: input.projectId, referenceFileId: input.fileId, view: 'excerpt' },
    })
    if (file.key !== input.key) throw new OrchestrationError('not_found', 'File not found')
    return {
      file,
      slice: await runWithOutboundOrganization(organizationId, () =>
        getCsvPreviewSlice({ key: file.key, context: 'project', signal: input.signal })
      ),
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
  async afterSuccess({ principal, result, input }) {
    await requireAdmittedContent(principal, {
      kind: 'workspace-file',
      id: input.fileId,
      provenance: result.secretProvenance ?? { status: 'unknown' },
      view: 'excerpt',
    })
    await reportWorkspaceFileDelivery(result.secretProvenance, input.fileId)
  },
})
