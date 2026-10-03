import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { IdempotencyService } from '@/lib/core/idempotency/service'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { decompressArchiveBufferToWorkspaceFiles, MAX_ARCHIVE_BYTES } from '@/lib/uploads/archive'
import {
  archiveWorkspaceFileFolderIfEmpty,
  createWorkspaceFileFolder,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getBoundWorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

const logger = createLogger('ExtractWorkspaceFile')
/**
 * Wall-clock budget for the whole operation — archive download included, because the lease
 * this must fit inside starts earlier still. Deliberately shorter than the route's
 * `maxDuration` so the work stops on our terms, with the all-or-nothing rollback still able
 * to run, rather than the platform killing the process mid-write and stranding a partial
 * tree. Self-hosted deployments do not enforce `maxDuration` at all, so this is the only
 * thing bounding the write loop there.
 */
const EXTRACTION_BUDGET_MS = 180 * 1000
/**
 * Must exceed {@link EXTRACTION_BUDGET_MS} plus the worst-case rollback, because
 * `IdempotencyService` reclaims an expired in-progress claim: a holder that outlives its
 * own lease would let a second unzip of the same archive start beside it.
 */
const EXTRACTION_LEASE_TTL_SECONDS = 6 * 60
/**
 * Used only through `atomicallyClaim`/`release`, never `executeWithIdempotency`, so no
 * result is ever stored — this is a lease, not a memoized operation.
 */
const extractionLeases = new IdempotencyService({
  namespace: 'workspace-file',
  ttlSeconds: EXTRACTION_LEASE_TTL_SECONDS,
  forceStorage: 'database',
})

export interface ExtractWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface ExtractWorkspaceFileResult {
  folderName: string
  /**
   * Internal display path of the destination folder, in the same
   * `Parent/Child` form the folder manager stores. Surfaces that address
   * folders by path project it themselves; the resolved name can differ from
   * the requested one when a sibling folder already claimed it.
   */
  folderDisplayPath: string
  extractedCount: number
  skippedCount: number
}

type ExtractWorkspaceFileUseCaseContext = AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.extractArchive,
  ExtractWorkspaceFileInput,
  ActiveWorkspaceFileContext
>

function archiveFolderName(fileName: string): string {
  const stripped = fileName
    .replace(/\.zip$/i, '')
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '-')
    .trim()
  return stripped && stripped !== '.' && stripped !== '..' ? stripped : 'archive'
}

async function withExtractionLease<T>(
  workspaceId: string,
  fileId: string,
  extract: () => Promise<T>
): Promise<T> {
  const claim = await extractionLeases.atomicallyClaim('extract', `${workspaceId}:${fileId}`)
  if (!claim.claimed) {
    throw new OrchestrationError('conflict', 'This archive is already being unzipped')
  }
  if (!claim.claimToken) throw new Error('Archive extraction lease is missing its fencing token')

  try {
    return await extract()
  } finally {
    await extractionLeases
      .release(claim.normalizedKey, claim.storageMethod, claim.claimToken)
      .catch((error) => {
        logger.warn('Failed to release archive extraction lease; TTL will expire it', {
          workspaceId,
          fileId,
          error: getErrorMessage(error),
        })
      })
  }
}

async function executeExtractWorkspaceFile(
  useCaseContext: ExtractWorkspaceFileUseCaseContext
): Promise<ExtractWorkspaceFileResult> {
  const { context } = useCaseContext
  return withExtractionLease(context.workspaceId, context.fileId, () =>
    extractWorkspaceFileContents(useCaseContext)
  )
}

async function extractWorkspaceFileContents({
  principal,
  context,
}: ExtractWorkspaceFileUseCaseContext): Promise<ExtractWorkspaceFileResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  if (!isArchiveFileName(file.name)) {
    throw new OrchestrationError('validation', 'Only .zip files can be unzipped')
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `Archive exceeds the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB unzip limit`
    )
  }

  const deadline = AbortSignal.timeout(EXTRACTION_BUDGET_MS)
  const folderName = archiveFolderName(file.name)
  const parentFolderSegments = file.folderPath
    ? parseWorkspaceFileFolderDisplayPath(file.folderPath)
    : []
  const [content, secretProvenance] = await Promise.all([
    fetchWorkspaceFileBuffer(file, { maxBytes: MAX_ARCHIVE_BYTES }),
    getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
      fileId: file.id,
      key: file.key,
      context: file.storageContext ?? 'workspace',
    }),
  ])
  let rootFolder: Awaited<ReturnType<typeof createWorkspaceFileFolder>> | undefined

  try {
    const result = await decompressArchiveBufferToWorkspaceFiles(content, {
      workspaceId: context.workspaceId,
      principal,
      rootFolderSegments: [...parentFolderSegments, folderName],
      prepareRootFolder: async (validateRootFolderSegments) => {
        const attribution = resolvePrincipalAttribution(principal, {
          workspaceBillingOwnerUserId: context.billedAccountUserId,
        })
        rootFolder = await createWorkspaceFileFolder({
          workspaceId: context.workspaceId,
          userId: attribution.attributedUserId,
          name: folderName,
          parentId: file.folderId,
          exactName: false,
          validateResolvedName: (resolvedName) =>
            validateRootFolderSegments([...parentFolderSegments, resolvedName]),
        })
        return parseWorkspaceFileFolderDisplayPath(rootFolder.path)
      },
      signal: deadline,
      skipNoiseEntries: true,
      secretProvenance,
      notifyWorkspaceChange: false,
    })
    if (result.extracted.length === 0) {
      throw new OrchestrationError('validation', `No files could be unzipped from "${file.name}"`)
    }
    if (result.skippedUnsafePaths.length > 0) {
      logger.warn('Skipped unsafe archive entries', {
        workspaceId: context.workspaceId,
        fileId: file.id,
        entryNames: result.skippedUnsafePaths,
      })
    }

    return {
      folderName: rootFolder?.name ?? folderName,
      folderDisplayPath: rootFolder?.path ?? folderName,
      extractedCount: result.extracted.length,
      skippedCount: result.skipped,
    }
  } catch (error) {
    if (rootFolder) {
      try {
        await archiveWorkspaceFileFolderIfEmpty({
          workspaceId: context.workspaceId,
          folderId: rootFolder.id,
        })
      } catch (cleanupError) {
        logger.warn('Left non-empty archive destination folder after extraction error', {
          workspaceId: context.workspaceId,
          folderId: rootFolder.id,
          cleanupError,
        })
      }
      await notifyWorkspaceFilesChanged(context.workspaceId)
    }
    if (deadline.aborted && error === deadline.reason) {
      logger.warn('Archive extraction exceeded its budget', {
        workspaceId: context.workspaceId,
        fileId: file.id,
        budgetMs: EXTRACTION_BUDGET_MS,
        wroteAnything: Boolean(rootFolder),
      })
      throw new OrchestrationError(
        'payload_too_large',
        `Unzipping "${file.name}" took too long and was cancelled. Try a smaller archive.`
      )
    }
    throw error
  }
}

export const extractWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.extractArchive,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeExtractWorkspaceFile,
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: context.fileId,
    description: `Unzipped workspace file ${context.fileId}`,
    metadata: {
      destinationFolder: result.folderName,
      destinationFolderPath: result.folderDisplayPath,
      extractedCount: result.extractedCount,
      skippedCount: result.skippedCount,
    },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceFilesChanged(context.workspaceId),
})
