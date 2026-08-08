import { createLogger } from '@sim/logger'
import type { NextResponse } from 'next/server'
import { getInlineWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'
import {
  createErrorResponse,
  encodeFilenameForHeader,
  FileNotFoundError,
  getSecureFileHeaders,
} from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInlineFileAPI')

const inlineFileErrorPolicy: { render(error: unknown): NextResponse | null } = {
  render(error): NextResponse | null {
    const classified = asOrchestrationError(error)
    if (classified) {
      if (classified.code === 'not_found' || classified.code === 'forbidden') {
        return createErrorResponse(new FileNotFoundError('Not found'))
      }
      return createErrorResponse(
        new Error(classified.message),
        statusForOrchestrationError(classified.code)
      )
    }
    if (error instanceof Error) {
      logger.error('Error serving workspace inline image', { error })
      return createErrorResponse(error)
    }
    const fallback = new Error('Failed to serve file')
    logger.error('Error serving workspace inline image', { error })
    return createErrorResponse(fallback)
  },
}

/**
 * GET /api/workspaces/[id]/files/inline?key=<cloudKey>|fileId=<id>
 *
 * Serves an authenticated workspace-scoped image. Authentication and the
 * `files.read_content` authorization check happen before resolving or reading
 * the referenced object, preserving cross-workspace concealment.
 */
export const GET = defineInternalBinaryRoute({
  contract: getInlineWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: readWorkspaceInlineFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Internal workspace inline image delivery' }),
  errorPolicy: inlineFileErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    key: query.key,
    fileId: query.fileId,
  }),
  useCase: readWorkspaceInlineFile,
  present: ({ file, stream }) => {
    const secure = getSecureFileHeaders(file.name, file.type)
    const headers = new Headers({
      'Content-Type': secure.contentType,
      'Content-Disposition': `${secure.disposition}; ${encodeFilenameForHeader(file.name)}`,
      'Cache-Control': 'private, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    })
    if (secure.contentType === 'image/svg+xml') {
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
      )
    }
    return {
      body: stream,
      contentType: secure.contentType,
      contentLength: file.size,
      headers,
    }
  },
})
