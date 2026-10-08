import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2CreateProjectFileContract,
  v2UpdateProjectFileContentContract,
} from '@/lib/api/contracts/v2/project-files'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import {
  V2_PARSE_DEFAULTS,
  v2InvalidBodyResponse,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { requireTrustedCopilotResourceExecutionContext } from '@/lib/mothership/auth/application-delegation'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { createProjectFile, updateProjectFileContent } from '@/lib/projects/files/application'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('ProjectFileWriteTransport')

/** Private inline writes carry only a proven empty classification; original source identities are never reconstructed. */
export function createProjectFileWriteTransport(options: {
  endpoint: string
  projectId: string
  context: AgentCliExecutionContext
  fallback: typeof fetch
  resolveSecretTraceRegistry?: () => Promise<ResolvedSecretTraceRegistry>
}): typeof fetch {
  const origin = new URL(options.endpoint).origin
  const projectId = options.projectId
  return async (input, init) => {
    const originalRequest = new Request(input, init)
    const url = new URL(originalRequest.url)
    let matched: ReturnType<typeof matchV2Route>
    try {
      matched = matchV2Route(url.pathname)
    } catch {
      return v2Error('BAD_REQUEST', 'CLI target is unavailable')
    }
    if (url.origin !== origin || !matched || matched.params.projectId !== projectId)
      return v2Error('BAD_REQUEST', 'CLI target is unavailable')
    const create =
      originalRequest.method === 'POST' && matched.pattern === '/api/v2/projects/{projectId}/files'
    const update =
      originalRequest.method === 'PUT' &&
      matched.pattern === '/api/v2/projects/{projectId}/files/{fileId}/content'
    if (!create && !update) return options.fallback(originalRequest)
    const request = new NextRequest(originalRequest)
    try {
      requireTrustedCopilotResourceExecutionContext(options.context)
    } catch {
      return v2Error('FORBIDDEN', 'Project file authority is unavailable')
    }
    const parseOptions = {
      ...V2_PARSE_DEFAULTS,
      maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
      invalidJsonResponse: () => v2InvalidBodyResponse(request),
    }
    try {
      options.context.signal?.throwIfAborted()
      request.signal.throwIfAborted()
      if (create) {
        const parsed = await parseRequest(
          v2CreateProjectFileContract,
          request,
          { params: matched.params },
          parseOptions
        )
        if (!parsed.success) return parsed.response
        const { params, body } = parsed.data
        await requireCleanInlineText(body, options)
        options.context.signal?.throwIfAborted()
        request.signal.throwIfAborted()
        const result = await executeCopilotProjectFileUseCase(
          options.context,
          createProjectFile,
          {
            projectId: params.projectId,
            name: body.name,
            contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
            content: body.content,
            encoding: body.encoding,
            folderPath: body.folderPath ?? '/',
            exactName: true,
            secretProvenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
          },
          { projectId }
        )
        const response = v2CreateProjectFileContract.response.schema.parse({
          data: toV2ProjectFile(result.file),
        })
        return v2Data(response.data, { status: v2CreateProjectFileContract.response.status })
      }
      const parsed = await parseRequest(
        v2UpdateProjectFileContentContract,
        request,
        { params: matched.params },
        parseOptions
      )
      if (!parsed.success) return parsed.response
      const { params, body } = parsed.data
      await requireCleanInlineText(body, options)
      options.context.signal?.throwIfAborted()
      request.signal.throwIfAborted()
      const target = { projectId, fileId: params.fileId }
      const result = await executeCopilotProjectFileUseCase(
        options.context,
        updateProjectFileContent,
        {
          ...target,
          content: body.content,
          encoding: body.encoding,
          expectedRevision: body.expectedRevision,
          secretProvenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
        },
        target
      )
      const response = v2UpdateProjectFileContentContract.response.schema.parse({
        data: toV2ProjectFile(result.file),
      })
      return v2Data(response.data)
    } catch (error) {
      options.context.signal?.throwIfAborted()
      request.signal.throwIfAborted()
      const response = v2OrchestrationErrorPolicy.render(error)
      if (response) return response
      logger.error('Project file write failed', { error })
      return v2Error('INTERNAL_ERROR', 'Project file write could not be completed')
    }
  }
}

async function requireCleanInlineText(
  body: { content: string; encoding: 'utf-8' | 'base64' },
  options: {
    context: AgentCliExecutionContext
    resolveSecretTraceRegistry?: () => Promise<ResolvedSecretTraceRegistry>
  }
): Promise<void> {
  const { context } = options
  context.signal?.throwIfAborted()
  if (body.encoding !== 'utf-8')
    throw new OrchestrationError(
      'forbidden',
      'Project CLI writes currently require UTF-8 text with verified secret provenance'
    )
  const registry = options.resolveSecretTraceRegistry
    ? await options.resolveSecretTraceRegistry()
    : context.resolvedSecretTraceRegistry
  const provenance = registry?.exportCommittedProvenanceForValue(body.content, { anonymous: true })
  if (!provenance?.complete || provenance.entries.length !== 0)
    throw new OrchestrationError(
      'forbidden',
      'Project file content cannot be published without complete, empty secret provenance'
    )
}
