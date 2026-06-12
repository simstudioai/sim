import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { type NextRequest, NextResponse } from 'next/server'
import { type LatexCompileBody, latexCompileContract } from '@/lib/api/contracts/tools/latex'
import { getValidationErrorMessage, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('LatexCompileAPI')

const LATEX_COMPILE_URL = 'https://latex.ytotech.com/builds/sync'
const DEFAULT_COMPILER = 'pdflatex'
const MAX_PDF_BYTES = 25 * 1024 * 1024
const MAX_ERROR_JSON_BYTES = 4 * 1024 * 1024
const MAX_ERROR_MESSAGE_CHARS = 4000
const MAX_ERROR_CODE_CHARS = 100
/** Leaves headroom within `maxDuration` to store the PDF after compilation. */
const COMPILE_TIMEOUT_MS = 50_000

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface StoredPdfResponse {
  pdfFile?: unknown
  pdfUrl: string
  fileName: string
  contentType: string
  compiler: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      latexCompileContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid LaTeX compile request:`, error.issues)
          return validationErrorResponse(
            error,
            getValidationErrorMessage(error, 'Invalid request data')
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const compiler = body.compiler || DEFAULT_COMPILER

    logger.info(`[${requestId}] Compiling LaTeX document`, {
      compiler,
      contentLength: body.content.length,
      resourceCount: body.resources?.length ?? 0,
    })

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(LATEX_COMPILE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler,
          resources: [{ main: true, content: body.content }, ...(body.resources ?? [])],
        }),
        signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS),
      })
    } catch (error) {
      // The timeout signal is the only abort source on this fetch, so an
      // AbortError here is a timeout regardless of which name undici uses.
      if (
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        logger.error(`[${requestId}] LaTeX compile service timed out`, {
          timeoutMs: COMPILE_TIMEOUT_MS,
        })
        return NextResponse.json({ error: 'LaTeX compile service timed out' }, { status: 504 })
      }
      throw error
    }

    const upstreamContentType = upstreamResponse.headers.get('content-type') || ''
    if (!upstreamResponse.ok || !upstreamContentType.includes('application/pdf')) {
      return await buildCompileErrorResponse(upstreamResponse, requestId)
    }

    const pdfBuffer = await readResponseToBufferWithLimit(upstreamResponse, {
      maxBytes: MAX_PDF_BYTES,
      label: 'compiled PDF',
    })
    if (pdfBuffer.length === 0) {
      logger.error(`[${requestId}] LaTeX compile service returned an empty PDF`)
      return NextResponse.json(
        { error: 'LaTeX compile service returned an empty PDF' },
        { status: 502 }
      )
    }

    const storedPdf = await storeCompiledPdf(pdfBuffer, body, compiler, authResult.userId)

    logger.info(`[${requestId}] LaTeX compilation completed`, {
      compiler,
      fileName: storedPdf.fileName,
      size: pdfBuffer.length,
    })

    return NextResponse.json(storedPdf)
  } catch (error) {
    logger.error(`[${requestId}] LaTeX compile route error:`, error)
    return NextResponse.json(
      { error: getErrorMessage(error, 'LaTeX compilation failed') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})

/**
 * Builds the output PDF filename: strips any directory components and
 * normalizes to a single `.pdf` extension.
 */
function buildPdfFileName(fileName: string | undefined): string {
  const base = (fileName || 'document').split(/[/\\]/).pop()?.trim() || 'document'
  const withoutExtension = base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base
  return `${withoutExtension || 'document'}.pdf`
}

/**
 * Extracts TeX error lines (lines starting with `!`, each with two lines of
 * context) from the compiler log files returned by the compile service.
 */
function extractCompilationErrors(logFiles: unknown): string | undefined {
  if (typeof logFiles !== 'object' || logFiles === null) return undefined

  const snippets: string[] = []
  for (const log of Object.values(logFiles)) {
    if (typeof log !== 'string') continue
    const lines = log.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('!')) {
        snippets.push(lines.slice(i, i + 3).join('\n'))
      }
    }
  }

  if (snippets.length === 0) return undefined
  return truncate([...new Set(snippets)].join('\n\n'), MAX_ERROR_MESSAGE_CHARS)
}

/**
 * Maps a failed compile-service response to a JSON error response: 422 with
 * extracted TeX errors for compilation failures, 502 for anything unexpected.
 */
async function buildCompileErrorResponse(
  upstreamResponse: Response,
  requestId: string
): Promise<NextResponse> {
  const errorBody = await readResponseJsonWithLimit(upstreamResponse, {
    maxBytes: MAX_ERROR_JSON_BYTES,
    label: 'LaTeX compile error response',
  }).catch(() => undefined)

  const errorRecord =
    typeof errorBody === 'object' && errorBody !== null
      ? (errorBody as Record<string, unknown>)
      : undefined
  const errorCode =
    typeof errorRecord?.error === 'string'
      ? truncate(errorRecord.error, MAX_ERROR_CODE_CHARS)
      : undefined
  const compilationErrors = extractCompilationErrors(errorRecord?.log_files)
  const details = compilationErrors ? `:\n${compilationErrors}` : ''

  const isCompilationFailure =
    upstreamResponse.status >= 400 &&
    upstreamResponse.status < 500 &&
    Boolean(errorCode || compilationErrors)

  if (isCompilationFailure) {
    logger.warn(`[${requestId}] LaTeX compilation failed`, {
      status: upstreamResponse.status,
      errorCode,
    })
    return NextResponse.json(
      { error: `LaTeX compilation failed (${errorCode || upstreamResponse.status})${details}` },
      { status: 422 }
    )
  }

  logger.error(`[${requestId}] LaTeX compile service error`, {
    status: upstreamResponse.status,
    errorCode,
  })
  return NextResponse.json(
    { error: `LaTeX compile service error: ${upstreamResponse.status}${details}` },
    { status: 502 }
  )
}

/**
 * Stores the compiled PDF as an execution file when execution context is
 * available, falling back to general storage otherwise.
 */
async function storeCompiledPdf(
  pdfBuffer: Buffer,
  body: LatexCompileBody,
  compiler: string,
  userId: string
): Promise<StoredPdfResponse> {
  const fileName = buildPdfFileName(body.fileName)
  const executionContext =
    body.workspaceId && body.workflowId && body.executionId
      ? {
          workspaceId: body.workspaceId,
          workflowId: body.workflowId,
          executionId: body.executionId,
        }
      : null

  if (executionContext) {
    const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
    const pdfFile = await uploadExecutionFile(
      executionContext,
      pdfBuffer,
      fileName,
      'application/pdf',
      userId
    )

    return {
      pdfFile,
      pdfUrl: pdfFile.url,
      fileName,
      contentType: 'application/pdf',
      compiler,
    }
  }

  const { StorageService } = await import('@/lib/uploads')
  const fileInfo = await StorageService.uploadFile({
    file: pdfBuffer,
    fileName,
    contentType: 'application/pdf',
    context: 'copilot',
  })

  return {
    pdfUrl: `${getBaseUrl()}${fileInfo.path}`,
    fileName,
    contentType: 'application/pdf',
    compiler,
  }
}
