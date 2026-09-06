import type { Principal } from '@sim/auth/principal'
import type { OperationUseCase, WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  loadActiveWorkspaceFileContext,
  resolveWorkspaceFileReference as resolveStoredWorkspaceFileReference,
  type WorkspaceFileLookupOptions,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ResolveWorkspaceFileReferenceInput {
  principal: Principal
  operation: WorkspaceOperation
  workspaceId: string
  reference: string
}

interface WorkspaceFileReferenceInput {
  workspaceId: string
  reference: string
  /** Trusted internal caller scope; public route contracts do not expose it. */
  chatId?: string
}

interface WorkspaceFileReferenceResult {
  file: WorkspaceFileRecord
}

interface WorkspaceFileReferenceReadInput extends WorkspaceFileReferenceInput {
  maxBytes: number
}

/** Canonical file context plus the record the reference resolved to. */
export interface ReferencedWorkspaceFileContext extends ActiveWorkspaceFileContext {
  file: WorkspaceFileRecord
}

/**
 * Reads may reach a chat upload through its explicit `uploads/<name>` reference (or its
 * own id); every other file operation resolves workspace files only, so no write, move,
 * rename, delete, or share can land on one.
 */
const CHAT_UPLOAD_LOOKUP: WorkspaceFileLookupOptions = { includeChatUploads: true }

/**
 * Resolves a VFS reference to its canonical authorization context, carrying the resolved
 * record so the caller needs no second load. Chat uploads are reachable only on opt-in.
 */
export async function resolveReferencedWorkspaceFileContext(
  principal: Principal,
  input: WorkspaceFileReferenceInput,
  options?: WorkspaceFileLookupOptions
): Promise<ReferencedWorkspaceFileContext> {
  const chatId =
    (principal.kind === 'delegated' && principal.serviceId === 'copilot'
      ? principal.resourceScope?.chatId
      : undefined) ?? input.chatId
  const file = await resolveStoredWorkspaceFileReference(
    input.workspaceId,
    input.reference,
    chatId === undefined ? options : { ...options, chatId }
  )
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const canonical = await loadActiveWorkspaceFileContext(file.id, options)
  if (!canonical || canonical.workspaceId !== input.workspaceId) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return { ...canonical, file }
}

function defineWorkspaceFileReferenceUseCase<const O extends WorkspaceOperation>(
  operation: O,
  options?: WorkspaceFileLookupOptions
) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: ({
      principal,
      input,
    }: {
      principal: Principal
      input: WorkspaceFileReferenceInput
    }) => resolveReferencedWorkspaceFileContext(principal, input, options),
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
  [fileOperations.readContent.id]: defineWorkspaceFileReferenceUseCase(
    fileOperations.readContent,
    CHAT_UPLOAD_LOOKUP
  ),
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
}: ResolveWorkspaceFileReferenceInput): Promise<WorkspaceFileRecord> {
  const useCase = getWorkspaceFileReferenceUseCase(operation)
  const result = await useCase.execute({ principal, input: { workspaceId, reference } })
  return result.file
}

export interface ReadWorkspaceFileReferenceInput
  extends Omit<ResolveWorkspaceFileReferenceInput, 'operation'> {
  maxBytes: number
}

const readWorkspaceFileReferenceUseCase = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: WorkspaceFileReferenceReadInput
  }) => resolveReferencedWorkspaceFileContext(principal, input, CHAT_UPLOAD_LOOKUP),
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
  maxBytes,
}: ReadWorkspaceFileReferenceInput): Promise<{ file: WorkspaceFileRecord; content: Buffer }> {
  return readWorkspaceFileReferenceUseCase.execute({
    principal,
    input: { workspaceId, reference, maxBytes },
  })
}
