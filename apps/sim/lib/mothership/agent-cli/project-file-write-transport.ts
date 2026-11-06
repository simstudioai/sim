import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2CreateProjectFileFolderContract,
  v2UpdateProjectFileFolderContract,
} from '@/lib/api/contracts/v2/project-file-folders'
import { v2RenameProjectFileContract } from '@/lib/api/contracts/v2/project-file-lifecycle'
import {
  v2CreateProjectFileContract,
  v2UpdateProjectFileContentContract,
} from '@/lib/api/contracts/v2/project-files'
import type { MatchedRoute } from '@/lib/api/server/routes/in-process-transport'
import {
  V2_PARSE_DEFAULTS,
  v2InvalidBodyResponse,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes/v2-json-route'
import { isV2ContractRoute } from '@/lib/api/server/routes/v2-route-pattern'
import { parseRequest } from '@/lib/api/server/validation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  matchProjectCliRoute,
  renderProjectCliFailure,
  throwIfCancelled,
} from '@/lib/mothership/agent-cli/project-file-transport'
import {
  type ProjectFileProvenanceOptions,
  requireCleanProjectFileMetadata,
} from '@/lib/mothership/agent-cli/project-file-write-provenance'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { requireTrustedCopilotResourceExecutionContext } from '@/lib/mothership/auth/application-delegation'
import { toCreateProjectFileInput } from '@/lib/projects/files/api/create-input'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { createProjectFile, updateProjectFileContent } from '@/lib/projects/files/application'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

const logger = createLogger('ProjectFileWriteTransport')

/** Forwarded writes that publish a caller-chosen name, so their metadata is checked first. */
const NAME_WRITE_CONTRACTS = [
  v2RenameProjectFileContract,
  v2CreateProjectFileFolderContract,
  v2UpdateProjectFileFolderContract,
] as const

/**
 * Parses a write that publishes a caller-chosen name under its route's size limit, or returns
 * undefined for forwarded writes that reference existing items only.
 */
function parseNameWrite(original: Request, route: MatchedRoute) {
  const contract = NAME_WRITE_CONTRACTS.find((candidate) =>
    isV2ContractRoute(original.method, route, candidate)
  )
  if (!contract) return undefined
  /** Only a name write is copied, so forwarded upload bodies are never teed. */
  const request = new NextRequest(original.clone())
  return parseRequest(
    contract,
    request,
    { params: route.params },
    {
      ...V2_PARSE_DEFAULTS,
      maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
      invalidJsonResponse: () => v2InvalidBodyResponse(request),
    }
  )
}

/** Private inline writes carry only a proven empty classification; original source identities are never reconstructed. */
export function createProjectFileWriteTransport(
  options: ProjectFileProvenanceOptions & {
    endpoint: string
    projectId: string
    fallback: typeof fetch
  }
): typeof fetch {
  const origin = new URL(options.endpoint).origin
  const projectId = options.projectId
  return async (input, init) => {
    const originalRequest = new Request(input, init)
    const matched = matchProjectCliRoute(originalRequest, origin, projectId)
    if (matched instanceof Response) return matched
    const create = isV2ContractRoute(originalRequest.method, matched, v2CreateProjectFileContract)
    const update = isV2ContractRoute(
      originalRequest.method,
      matched,
      v2UpdateProjectFileContentContract
    )
    if (!create && !update) {
      const nameWrite = parseNameWrite(originalRequest, matched)
      if (!nameWrite) return options.fallback(originalRequest)
      try {
        const parsed = await nameWrite
        if (!parsed.success) return parsed.response
        await requireCleanProjectFileMetadata(parsed.data.body, options)
        throwIfCancelled(options.context.signal, originalRequest.signal)
      } catch (error) {
        throwIfCancelled(options.context.signal, originalRequest.signal)
        const response = v2OrchestrationErrorPolicy.render(error)
        if (response) return response
        throw error
      }
      return options.fallback(originalRequest)
    }
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
      throwIfCancelled(options.context.signal, request.signal)
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
        throwIfCancelled(options.context.signal, request.signal)
        const result = await executeCopilotProjectFileUseCase(
          options.context,
          createProjectFile,
          {
            ...toCreateProjectFileInput(params.projectId, body),
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
      throwIfCancelled(options.context.signal, request.signal)
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
      return renderProjectCliFailure(error, [options.context.signal, request.signal], logger, {
        log: 'Project file write failed',
        message: 'Project file write could not be completed',
      })
    }
  }
}

async function requireCleanInlineText(
  body: { content: string; encoding: 'utf-8' | 'base64' },
  options: ProjectFileProvenanceOptions
): Promise<void> {
  const { context } = options
  context.signal?.throwIfAborted()
  if (body.encoding !== 'utf-8')
    throw new OrchestrationError(
      'forbidden',
      'Project CLI writes currently require UTF-8 text with verified secret provenance'
    )
  await requireCleanProjectFileMetadata(body, options)
}
