import { truncate } from '@sim/utils/string'
import {
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { LatexOperationError } from '@/lib/internal/latex/errors'
import type { LatexCompileInput } from '@/lib/internal/latex/schema'
import { StorageService } from '@/lib/uploads'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'

const LATEX_COMPILE_URL = 'https://latex.ytotech.com/builds/sync'
const MAX_PDF_BYTES = 25 * 1024 * 1024
const MAX_ERROR_JSON_BYTES = 4 * 1024 * 1024
const MAX_ERROR_MESSAGE_CHARS = 4000
const MAX_ERROR_CODE_CHARS = 100
const COMPILE_TIMEOUT_MS = 50_000

export interface LatexOperationContext {
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
}

function buildPdfFileName(fileName: string | undefined): string {
  const base = (fileName || 'document').split(/[/\\]/).pop()?.trim() || 'document'
  const withoutExtension = base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base
  return `${withoutExtension || 'document'}.pdf`
}

function extractCompilationErrors(logFiles: unknown): string | undefined {
  if (typeof logFiles !== 'object' || logFiles === null) return undefined
  const snippets: string[] = []
  for (const log of Object.values(logFiles)) {
    if (typeof log !== 'string') continue
    const lines = log.split('\n')
    for (let index = 0; index < lines.length; index++) {
      if (lines[index].startsWith('!')) snippets.push(lines.slice(index, index + 3).join('\n'))
    }
  }
  return snippets.length
    ? truncate([...new Set(snippets)].join('\n\n'), MAX_ERROR_MESSAGE_CHARS)
    : undefined
}

async function compileError(
  response: Response,
  signal?: AbortSignal
): Promise<LatexOperationError> {
  const body = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_ERROR_JSON_BYTES,
    label: 'LaTeX compile error response',
    signal,
  }).catch(() => undefined)
  const record =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const errorCode =
    typeof record?.error === 'string' ? truncate(record.error, MAX_ERROR_CODE_CHARS) : undefined
  const compilationErrors = extractCompilationErrors(record?.log_files)
  const details = compilationErrors ? `:\n${compilationErrors}` : ''
  const compilationFailure =
    response.status >= 400 && response.status < 500 && Boolean(errorCode || compilationErrors)
  return compilationFailure
    ? new LatexOperationError(
        `LaTeX compilation failed (${errorCode || response.status})${details}`,
        422
      )
    : new LatexOperationError(`LaTeX compile service error: ${response.status}${details}`, 502)
}

export async function compileLatexDocument(
  input: LatexCompileInput,
  context: LatexOperationContext
) {
  context.signal?.throwIfAborted()
  const compiler = input.compiler || 'pdflatex'
  const timeoutSignal = AbortSignal.timeout(COMPILE_TIMEOUT_MS)
  const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await fetch(LATEX_COMPILE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler,
        resources: [{ main: true, content: input.content }, ...(input.resources ?? [])],
      }),
      signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (timeoutSignal.aborted) {
      throw new LatexOperationError('LaTeX compile service timed out', 504)
    }
    throw error
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/pdf')) {
    throw await compileError(response, context.signal)
  }
  const pdf = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_PDF_BYTES,
    label: 'compiled PDF',
    signal: context.signal,
  })
  if (!pdf.length) {
    throw new LatexOperationError('LaTeX compile service returned an empty PDF', 502)
  }
  context.signal?.throwIfAborted()
  const fileName = buildPdfFileName(input.fileName)
  if (context.workspaceId && context.workflowId && context.executionId) {
    const pdfFile = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      pdf,
      fileName,
      'application/pdf',
      context.userId
    )
    context.signal?.throwIfAborted()
    return {
      pdfFile,
      pdfUrl: pdfFile.url,
      fileName,
      contentType: 'application/pdf',
      compiler,
    }
  }

  const fileInfo = await StorageService.uploadFile({
    file: pdf,
    fileName,
    contentType: 'application/pdf',
    context: 'copilot',
  })
  context.signal?.throwIfAborted()
  return {
    pdfUrl: `${getBaseUrl()}${fileInfo.path}`,
    fileName,
    contentType: 'application/pdf',
    compiler,
  }
}
