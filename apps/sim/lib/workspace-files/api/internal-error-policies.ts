import { createLogger } from '@sim/logger'
import {
  createInternalResourceConcealmentPolicy,
  extendInternalErrorPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { StorageLimitExceededError } from '@/lib/billing/storage'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { ArchiveError, statusForArchiveError } from '@/lib/uploads/archive'
import {
  CompiledCheckTooLargeError,
  CompiledCheckUnsupportedError,
} from '@/lib/workspace-files/application/compiled-check-workspace-file'
import { StyleExtractionUnsupportedError } from '@/lib/workspace-files/application/style-workspace-file'

const logger = createLogger('InternalWorkspaceFileErrors')

const style = extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
  if (!(error instanceof StyleExtractionUnsupportedError)) return null
  return internalErrorResponse(422, { error: error.message })
})

const compiledCheck = extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
  if (error instanceof CompiledCheckUnsupportedError) {
    return internalErrorResponse(422, { error: error.message })
  }
  if (error instanceof CompiledCheckTooLargeError) {
    return internalErrorResponse(413, { error: error.message })
  }
  return null
})

const content = extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
  if (!(error instanceof StorageLimitExceededError)) return null
  return internalErrorResponse(402, { error: error.message })
})

const downloadUrl: InternalErrorPolicy = {
  project(error) {
    const typed = internalOrchestrationErrorPolicy.project(error)
    if (typed) return typed
    logger.error('Failed to generate workspace file download URL', { error })
    return internalErrorResponse(500, { error: 'Failed to generate download URL' })
  },
}

const downloadArchive: InternalErrorPolicy = {
  project(error) {
    const classified = asOrchestrationError(error)
    if (classified) {
      return internalErrorResponse(statusForOrchestrationError(classified.code), {
        error: classified.message,
      })
    }
    logger.error('Failed to download workspace file selection', { error })
    return internalErrorResponse(500, { error: 'Internal server error' })
  },
}

const inline: InternalErrorPolicy = {
  project(error) {
    const classified = asOrchestrationError(error)
    if (classified) {
      if (classified.code === 'not_found' || classified.code === 'forbidden') {
        return internalErrorResponse(404, { error: 'FileNotFoundError', message: 'Not found' })
      }
      return internalErrorResponse(statusForOrchestrationError(classified.code), {
        error: 'Error',
        message: classified.message,
      })
    }
    if (error instanceof Error) {
      logger.error('Error serving workspace inline image', { error })
      return internalErrorResponse(500, { error: error.name, message: error.message })
    }
    logger.error('Error serving workspace inline image', { error })
    return internalErrorResponse(500, { error: 'Error', message: 'Failed to serve file' })
  },
}

const FILE_NOT_FOUND_MESSAGE = 'File not found'

const concealResourceAuthorization = createInternalResourceConcealmentPolicy({
  base: internalOrchestrationErrorPolicy,
  notFoundMessage: FILE_NOT_FOUND_MESSAGE,
})

const extractArchive = extendInternalErrorPolicy(concealResourceAuthorization, (error) => {
  if (!(error instanceof ArchiveError)) return null
  return internalErrorResponse(statusForArchiveError(error), { error: error.message })
})

export const internalFileErrorPolicies = {
  default: internalOrchestrationErrorPolicy,
  content,
  /**
   * Single-file internal routes reach the same use cases as the concealing v2
   * file routes, so they withhold the same cross-tenant existence signal.
   */
  concealResourceAuthorization,
  concealContentAuthorization: createInternalResourceConcealmentPolicy({
    base: content,
    notFoundMessage: FILE_NOT_FOUND_MESSAGE,
  }),
  style,
  compiledCheck,
  downloadUrl,
  downloadArchive,
  extractArchive,
  inline,
} as const
