import type { Principal } from '@sim/auth/principal'
import type { OperationUseCase, WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFileByName,
  listWorkspaceFiles,
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
  /** Resolve `reference` as an exact file name in this folder instead of as a path or id. */
  folderId?: string | null
  /** Trusted internal chat scope; never accepted from public file contracts. */
  chatId?: string
}

interface WorkspaceFileReferenceInput {
  workspaceId: string
  reference: string
  folderId?: string | null
  /** Trusted internal caller scope; public route contracts do not expose it. */
  chatId?: string
  /** Owned by one resolver invocation group; never accepted from a surface contract. */
  loadFallbackFiles?: () => Promise<WorkspaceFileRecord[]>
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
 * Content reads may reach a chat upload through its explicit `uploads/<name>` reference (or its
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
  const file =
    input.folderId === undefined
      ? await resolveStoredWorkspaceFileReference(
          input.workspaceId,
          input.reference,
          input.loadFallbackFiles || chatId !== undefined
            ? {
                ...options,
                ...(chatId === undefined ? {} : { chatId }),
                ...(input.loadFallbackFiles ? { loadFallbackFiles: input.loadFallbackFiles } : {}),
              }
            : options
        )
      : await getWorkspaceFileByName(input.workspaceId, input.reference, {
          folderId: input.folderId,
        })
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
  [fileOperations.readMetadata.id]: defineWorkspaceFileReferenceUseCase(
    fileOperations.readMetadata
  ),
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
  folderId,
  chatId,
}: ResolveWorkspaceFileReferenceInput): Promise<WorkspaceFileRecord> {
  const useCase = getWorkspaceFileReferenceUseCase(operation)
  return executeReferenceLookup(principal, useCase, {
    workspaceId,
    reference,
    ...(folderId === undefined ? {} : { folderId }),
    ...(chatId === undefined ? {} : { chatId }),
  })
}

/**
 * Resolves a group of references without repeating the legacy whole-workspace fallback.
 * Exact lookups stay lazy and fresh; every result still reloads canonical context and authorizes.
 */
export function createWorkspaceFileReferenceResolver({
  principal,
  operation,
  workspaceId,
  chatId,
}: Omit<ResolveWorkspaceFileReferenceInput, 'reference' | 'folderId'>) {
  const useCase = getWorkspaceFileReferenceUseCase(operation)
  let fallbackFiles: Promise<WorkspaceFileRecord[]> | undefined
  const loadFallbackFiles = () =>
    (fallbackFiles ??= listWorkspaceFiles(workspaceId, { throwOnError: true }))
  return (reference: string): Promise<WorkspaceFileRecord> =>
    executeReferenceLookup(principal, useCase, {
      workspaceId,
      reference,
      ...(chatId === undefined ? {} : { chatId }),
      loadFallbackFiles,
    })
}

async function executeReferenceLookup(
  principal: Principal,
  useCase: WorkspaceFileReferenceUseCase,
  input: WorkspaceFileReferenceInput
): Promise<WorkspaceFileRecord> {
  const result = await useCase.execute({
    principal,
    input,
  })
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
  folderId,
  maxBytes,
  chatId,
}: ReadWorkspaceFileReferenceInput): Promise<{ file: WorkspaceFileRecord; content: Buffer }> {
  return readWorkspaceFileReferenceUseCase.execute({
    principal,
    input: {
      workspaceId,
      reference,
      maxBytes,
      ...(chatId === undefined ? {} : { chatId }),
      ...(folderId === undefined ? {} : { folderId }),
    },
  })
}
