import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { withFolderTreeLock } from '@/lib/folders/locks'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'
import {
  type TableAuthorizationContext,
  tableDelegationPolicy,
} from '@/lib/table/application/authorization'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import {
  abortAuthorizedTableImportUpload,
  type CreateTableImportRequest,
  type CreateTableImportResult as CreateTableImportResourceResult,
  cancelTableImportResource,
  createAuthorizedTableImportResource,
  findTableImportResource,
  getPrincipalTableImportUpload,
  getTableImportResource,
  startUploadedTableImport,
  type TableImportResource,
  tableImportBodyFromUpload,
  tableImportResourceFromUpload,
} from '@/lib/table/orchestration/import-resource'
import {
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { requestOrigin } from '@/lib/uploads/upload-session/application'
import {
  assertUploadSessionAuthBinding,
  completeUploadSession,
  createUploadPartUrls,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'

const logger = createLogger('TableImportApplication')

export interface CreateTableImportInput {
  body: CreateTableImportRequest
}

export interface TableImportResourceInput {
  importId: string
  workspaceId: string
}

export interface TableImportUploadInput extends TableImportResourceInput {
  uploadToken: string
}

export interface CreateTableImportPartsInput extends TableImportUploadInput {
  partNumbers: number[]
}

export interface ReadTableImportInput extends TableImportResourceInput {
  uploadToken?: string
}

export interface CancelTableImportInput extends TableImportResourceInput {
  uploadToken?: string
}

export interface CreateTableImportResult {
  import: CreateTableImportResourceResult
}

export interface TableImportResult {
  import: TableImportResource
}

export interface CreateTableImportPartsResult {
  parts: Awaited<ReturnType<typeof createUploadPartUrls>>
}

interface TableImportContext extends TableAuthorizationContext {
  importId: string
  record: TableImportResource
}

interface TableImportUploadContext extends TableAuthorizationContext {
  importId: string
  upload: UploadSessionRecord
}

async function resolveCreateTableImportContext(input: CreateTableImportInput) {
  if (input.body.target.type === 'existing') {
    const { tableId: _tableId, ...context } = await resolveActiveTableContext({
      tableId: input.body.target.tableId,
      assertedWorkspaceId: input.body.workspaceId,
    })
    return context
  }
  return resolveTableWorkspaceContext(input.body.workspaceId)
}

async function resolveTableImportContext(
  input: TableImportResourceInput
): Promise<TableImportContext> {
  const record = await getTableImportResource({
    importId: input.importId,
    assertedWorkspaceId: input.workspaceId,
  })
  const workspace = await resolveTableWorkspaceContext(record.workspaceId)
  return {
    ...workspace,
    importId: record.id,
    record,
  }
}

async function resolveTableImportUploadContext(
  principal: Principal,
  input: TableImportUploadInput
): Promise<TableImportUploadContext> {
  const upload = await getPrincipalTableImportUpload({
    importId: input.importId,
    assertedWorkspaceId: input.workspaceId,
    principal,
    uploadToken: input.uploadToken,
  })
  const body = tableImportBodyFromUpload(upload)
  const workspace = await resolveTableWorkspaceContext(body.workspaceId)
  return {
    ...workspace,
    importId: upload.id,
    upload,
  }
}

async function resolveImportFolderId(
  workspaceId: string,
  body: CreateTableImportRequest
): Promise<string | null | undefined> {
  if (body.target.type !== 'new') return undefined
  const path = body.target.folderPath ?? ROOT_FOLDER_PATH
  return withFolderTreeLock(workspaceId, 'table', async (tx) => {
    const index = await loadActiveFolderPathIndex(workspaceId, 'table', tx, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    const folderId = resolveFolderPathFromIndex(index, path)
    if (folderId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }
    return folderId
  })
}

async function loadAuthorizedTableImportWorkspaceFile(
  workspaceId: string,
  fileId: string
): Promise<WorkspaceFileRecord> {
  const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return file
}

export const createTableImportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createImport,
  resolveContext: ({ input }: { input: CreateTableImportInput }) =>
    resolveCreateTableImportContext(input),
  async execute({ principal, input, context, request }): Promise<CreateTableImportResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const folderId = await resolveImportFolderId(context.workspaceId, input.body)
    const workspaceFile =
      input.body.source.type === 'workspace_file'
        ? await loadAuthorizedTableImportWorkspaceFile(
            context.workspaceId,
            input.body.source.fileId
          )
        : undefined
    if (input.body.source.type === 'upload' && !request) {
      throw new Error('Table import upload creation requires a request context')
    }
    const created = await createAuthorizedTableImportResource({
      body: input.body,
      userId: attribution.attributedUserId,
      principal,
      localOrigin: request ? requestOrigin(request) : undefined,
      resolvedFolderId: folderId,
      workspaceFile,
    })
    logger.info('Created table import', {
      importId: created.record.id,
      workspaceId: context.workspaceId,
      sourceType: input.body.source.type,
      targetType: input.body.target.type,
      principalKind: principal.kind,
    })
    return { import: created }
  },
})

/**
 * Reads an import, including while its upload is still in flight.
 *
 * An upload-sourced import has no durable job row until the upload completes,
 * so a caller holding the upload token is resolved against the session instead —
 * the same branch `cancelTableImportUseCase` takes. The job is still preferred
 * once it exists: the upload session lingers in a completed state after the
 * runner starts, and reporting `uploading` for an import that is already
 * processing would strand a poller.
 */
export const readTableImportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.readImport,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadTableImportInput
  }) {
    return input.uploadToken
      ? resolveTableImportUploadContext(principal, { ...input, uploadToken: input.uploadToken })
      : resolveTableImportContext(input)
  },
  async execute({ context }): Promise<TableImportResult> {
    if (!('upload' in context)) return { import: context.record }
    const started = await findTableImportResource({
      importId: context.upload.id,
      assertedWorkspaceId: context.workspaceId,
    })
    return { import: started ?? tableImportResourceFromUpload(context.upload) }
  },
})

export const createTableImportPartsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createImportParts,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateTableImportPartsInput
  }) => resolveTableImportUploadContext(principal, input),
  async execute({ input, context, request }): Promise<CreateTableImportPartsResult> {
    if (!request) throw new Error('Table import part creation requires a request context')
    return {
      parts: await createUploadPartUrls({
        session: context.upload,
        partNumbers: input.partNumbers,
        localOrigin: requestOrigin(request),
      }),
    }
  },
})

export const completeTableImportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.completeImport,
  resolveContext: ({ principal, input }: { principal: Principal; input: TableImportUploadInput }) =>
    resolveTableImportUploadContext(principal, input),
  async execute({ principal, context }): Promise<TableImportResult> {
    const existing = await findTableImportResource({
      importId: context.upload.id,
      assertedWorkspaceId: context.workspaceId,
    })
    if (existing) return { import: existing }

    const completed = await completeUploadSession({
      session: context.upload,
      finalize: async (claimed) => {
        assertUploadSessionAuthBinding(claimed, principal)
        await authorizeWorkspaceOperation(principal, tableOperations.completeImport, context, {
          delegation: tableDelegationPolicy,
        })
        return { value: null }
      },
    })
    const started = await startUploadedTableImport(completed.session)
    logger.info('Completed table import upload', {
      importId: started.id,
      workspaceId: context.workspaceId,
      tableId: started.tableId,
      principalKind: principal.kind,
    })
    return { import: started }
  },
})

export const cancelTableImportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.cancelImport,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Principal
    input: CancelTableImportInput
  }) {
    return input.uploadToken
      ? resolveTableImportUploadContext(principal, {
          ...input,
          uploadToken: input.uploadToken,
        })
      : resolveTableImportContext(input)
  },
  async execute({ principal, context }): Promise<TableImportResult> {
    const record =
      'upload' in context
        ? await abortAuthorizedTableImportUpload(context.upload, principal)
        : await cancelTableImportResource(context.record)
    logger.info('Canceled table import', {
      importId: record.id,
      workspaceId: context.workspaceId,
      tableId: record.tableId,
      principalKind: principal.kind,
    })
    return { import: record }
  },
})
