import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { BINARY_DOC_TASKS, MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { validateMermaidSource } from '@/lib/mermaid/validate'
import { getE2BDocFormat } from '@/lib/mothership/tools/server/files/doc-compile'
import { runE2BCompiledCheck } from '@/lib/mothership/tools/server/files/doc-recalc'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import type { ActiveWorkspaceFileContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export class CompiledCheckUnsupportedError extends Error {
  constructor() {
    super('Compiled check only supports .docx, .pptx, .pdf, .xlsx, and .mmd files')
    this.name = 'CompiledCheckUnsupportedError'
  }
}

export class CompiledCheckTooLargeError extends Error {
  constructor() {
    super('File source exceeds maximum size')
    this.name = 'CompiledCheckTooLargeError'
  }
}

export interface CompiledCheckWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export type CompiledCheckWorkspaceFileResult =
  | { ok: true }
  | { ok: false; error: string; errorName: string }

function normalizeCompiledCheckResult(result: {
  ok: boolean
  error?: string
  errorName?: string
}): CompiledCheckWorkspaceFileResult {
  if (result.ok) return { ok: true }
  return {
    ok: false,
    error: result.error ?? 'Compiled check failed',
    errorName: result.errorName ?? 'CompiledCheckError',
  }
}

async function executeCompiledCheckWorkspaceFile({
  principal,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.compiledCheck,
  CompiledCheckWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<CompiledCheckWorkspaceFileResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const e2bFmt = isDocSandboxEnabled ? await getE2BDocFormat(file.name) : null
  const taskId = BINARY_DOC_TASKS[ext]
  const isMermaidFile = ext === 'mmd' || ext === 'mermaid'
  if (!e2bFmt && !taskId && !isMermaidFile) throw new CompiledCheckUnsupportedError()

  if (file.size > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
    throw new CompiledCheckTooLargeError()
  }

  const content = await fetchWorkspaceFileBuffer(file, {
    maxBytes: MAX_DOCUMENT_PREVIEW_CODE_BYTES,
  })

  const code = content.toString('utf-8')
  if (Buffer.byteLength(code, 'utf-8') > MAX_DOCUMENT_PREVIEW_CODE_BYTES) {
    throw new CompiledCheckTooLargeError()
  }
  if (isMermaidFile) return normalizeCompiledCheckResult(await validateMermaidSource(code))
  if (e2bFmt) {
    return normalizeCompiledCheckResult(
      await runE2BCompiledCheck({
        source: code,
        fileName: file.name,
        workspaceId: file.workspaceId,
        ext,
        principal,
      })
    )
  }

  try {
    if (!taskId) throw new CompiledCheckUnsupportedError()
    await runSandboxTask(
      taskId,
      { code, workspaceId: file.workspaceId },
      { ownerKey: `user:${principal.userId}` }
    )
    return { ok: true }
  } catch (error) {
    if (error instanceof SandboxUserCodeError) {
      return { ok: false, error: error.message, errorName: error.name }
    }
    throw error
  }
}

export const compiledCheckWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.compiledCheck,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeCompiledCheckWorkspaceFile,
})
