import type { Principal } from '@sim/auth/principal'
import type { OperationUseCase, WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFileByName,
  loadActiveWorkspaceFileContext,
  resolveWorkspaceFileReference as resolveStoredWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ResolveWorkspaceFileReferenceInput {
  principal: Principal
  operation: WorkspaceOperation
  workspaceId: string
  reference: string
  /** Resolve `reference` as an exact file name in this folder instead of as a path or id. */
  folderId?: string | null
}

interface WorkspaceFileReferenceInput {
  workspaceId: string
  reference: string
  folderId?: string | null
}

interface WorkspaceFileReferenceResult {
  file: WorkspaceFileRecord
}

interface WorkspaceFileReferenceReadInput extends WorkspaceFileReferenceInput {
  maxBytes: number
}

async function resolveWorkspaceFileReferenceContext({
  input,
}: {
  input: WorkspaceFileReferenceInput
}) {
  const file =
    input.folderId === undefined
      ? await resolveStoredWorkspaceFileReference(input.workspaceId, input.reference)
      : await getWorkspaceFileByName(input.workspaceId, input.reference, {
          folderId: input.folderId,
        })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const canonical = await loadActiveWorkspaceFileContext(file.id)
  if (!canonical || canonical.workspaceId !== input.workspaceId) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return { ...canonical, file }
}

function defineWorkspaceFileReferenceUseCase<const O extends WorkspaceOperation>(operation: O) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: resolveWorkspaceFileReferenceContext,
    async execute({ context }): Promise<WorkspaceFileReferenceResult> {
      return { file: context.file }
    },
  })
}

type WorkspaceFileReferenceUseCase = OperationUseCase<
  WorkspaceOperation,
  WorkspaceFileReferenceInput,
  WorkspaceFileReferenceResult
>

const workspaceFileReferenceUseCases = {
  [fileOperations.readContent.id]: defineWorkspaceFileReferenceUseCase(fileOperations.readContent),
  [fileOperations.create.id]: defineWorkspaceFileReferenceUseCase(fileOperations.create),
  [fileOperations.rename.id]: defineWorkspaceFileReferenceUseCase(fileOperations.rename),
  [fileOperations.updateContent.id]: defineWorkspaceFileReferenceUseCase(
    fileOperations.updateContent
  ),
  [fileOperations.move.id]: defineWorkspaceFileReferenceUseCase(fileOperations.move),
  [fileOperations.delete.id]: defineWorkspaceFileReferenceUseCase(fileOperations.delete),
  [fileOperations.updateShare.id]: defineWorkspaceFileReferenceUseCase(fileOperations.updateShare),
} satisfies Record<string, WorkspaceFileReferenceUseCase>

function getWorkspaceFileReferenceUseCase(operation: WorkspaceOperation) {
  const operationId = operation.id as keyof typeof workspaceFileReferenceUseCases
  const useCase: WorkspaceFileReferenceUseCase | undefined =
    workspaceFileReferenceUseCases[operationId]
  if (!useCase || useCase.operation !== operation) {
    throw new Error(`No workspace file reference resolver is defined for ${operation.id}`)
  }
  return useCase
}

/** Resolve one workspace-file reference under an explicit semantic operation policy. */
export async function resolveWorkspaceFileReference({
  principal,
  operation,
  workspaceId,
  reference,
  folderId,
}: ResolveWorkspaceFileReferenceInput): Promise<WorkspaceFileRecord> {
  const useCase = getWorkspaceFileReferenceUseCase(operation)
  const result = await useCase.execute({
    principal,
    input: { workspaceId, reference, ...(folderId === undefined ? {} : { folderId }) },
  })
  return result.file
}

export interface ReadWorkspaceFileReferenceInput
  extends Omit<ResolveWorkspaceFileReferenceInput, 'operation'> {
  maxBytes: number
}

const readWorkspaceFileReferenceUseCase = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }: { input: WorkspaceFileReferenceReadInput }) =>
    resolveWorkspaceFileReferenceContext({ input }),
  async execute({ input, context }): Promise<{ file: WorkspaceFileRecord; content: Buffer }> {
    return {
      file: context.file,
      content: await fetchWorkspaceFileBuffer(context.file, { maxBytes: input.maxBytes }),
    }
  },
})

/** Resolve one trusted workspace-file reference and read it under the shared file policy. */
export async function readWorkspaceFileReference({
  principal,
  workspaceId,
  reference,
  folderId,
  maxBytes,
}: ReadWorkspaceFileReferenceInput): Promise<{ file: WorkspaceFileRecord; content: Buffer }> {
  return readWorkspaceFileReferenceUseCase.execute({
    principal,
    input: {
      workspaceId,
      reference,
      maxBytes,
      ...(folderId === undefined ? {} : { folderId }),
    },
  })
}
