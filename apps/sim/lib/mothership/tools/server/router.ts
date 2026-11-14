import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server/validation'
import { OAUTH_API_WRITE_SCOPE } from '@/lib/auth/oauth-provider'
import { requireDelegatedApiScope } from '@/lib/core/application/oauth-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withFileTabFlag } from '@/lib/mothership/resources/file-tabs'
import { copilotToolCanWrite, copilotWriteDeniedMessage } from '@/lib/mothership/tools/permissions'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'
import { changelogServerTool } from '@/lib/mothership/tools/server/changelog'
import { dashboardsServerTool } from '@/lib/mothership/tools/server/dashboards'
import { searchDocsServerTool } from '@/lib/mothership/tools/server/docs/search-docs'
import { editContentServerTool } from '@/lib/mothership/tools/server/files/edit-content'
import { workspaceFileServerTool } from '@/lib/mothership/tools/server/files/workspace-file'
import { validateGeneratedToolPayload } from '@/lib/mothership/tools/server/generated-schema'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/mothership/tools/server/knowledge/workspace-search'
import { ffmpegServerTool } from '@/lib/mothership/tools/server/media/ffmpeg'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { openResourceServerTool } from '@/lib/mothership/tools/server/open-resource'
import { listProjectsServerTool } from '@/lib/mothership/tools/server/project-list'
import { organizationSearchSourcesServerTool } from '@/lib/mothership/tools/server/search-sources'
import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { testsServerTool } from '@/lib/mothership/tools/server/tests'
import { getCredentialsServerTool } from '@/lib/mothership/tools/server/user/get-credentials'
import { listWorkspacesServerTool } from '@/lib/mothership/tools/server/workspace-list'
import { workspacesServerTool } from '@/lib/mothership/tools/server/workspaces'

export type ExecuteResponseSuccess = z.output<typeof ExecuteResponseSuccessSchema>

const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const logger = createLogger('ServerToolRouter')

/** Registry of all server tools. Tools self-declare their validation schemas. */
const baseServerToolRegistry: Record<string, BaseServerTool> = {
  [dashboardsServerTool.name]: dashboardsServerTool,
  [changelogServerTool.name]: changelogServerTool,
  [testsServerTool.name]: testsServerTool,
  [searchDocsServerTool.name]: searchDocsServerTool,
  [searchWorkspaceServerTool.name]: searchWorkspaceServerTool,
  [listWorkspacesServerTool.name]: listWorkspacesServerTool,
  [listProjectsServerTool.name]: listProjectsServerTool,
  [workspacesServerTool.name]: workspacesServerTool,
  [organizationSearchSourcesServerTool.name]: organizationSearchSourcesServerTool,
  [settingsServerTool.name]: settingsServerTool,
  [openResourceServerTool.name]: openResourceServerTool,
  [readDocumentServerTool.name]: readDocumentServerTool,
  // The streamed file-writing pair: prepare opens the write (live preview),
  // apply continues it. The preview machinery keys off these exact names.
  [workspaceFileServerTool.name]: withFileTabFlag(workspaceFileServerTool),
  [editContentServerTool.name]: withFileTabFlag(editContentServerTool),
  [generateImageServerTool.name]: generateImageServerTool,
  [generateVideoServerTool.name]: generateVideoServerTool,
  [generateAudioServerTool.name]: generateAudioServerTool,
  [ffmpegServerTool.name]: ffmpegServerTool,
  // Not agent-reachable: the internal credentials route dispatches this directly.
  [getCredentialsServerTool.name]: getCredentialsServerTool,
}

function getServerToolRegistry(): Record<string, BaseServerTool> {
  return baseServerToolRegistry
}

export function getRegisteredServerToolNames(): string[] {
  return Object.keys(getServerToolRegistry())
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolContext
): Promise<unknown> {
  const tool = getServerToolRegistry()[toolName]
  if (!tool) {
    throw new OrchestrationError('validation', `Unknown server tool: ${toolName}`)
  }

  logger.debug(
    context?.messageId ? `Routing to tool [messageId:${context.messageId}]` : 'Routing to tool',
    { toolName }
  )

  assertServerToolNotAborted(
    context,
    `User stop signal aborted ${toolName} before payload normalization`
  )

  // Go injects chatId/workspaceId and may wrap the model's args inside a
  // nested "args" object. Unwrap that before validation so the generated
  // JSON Schema sees the flat tool contract shape.
  let normalizedPayload = payload ?? {}
  if (isRecordLike(normalizedPayload)) {
    const raw = normalizedPayload as Record<string, unknown>
    if (raw.args && typeof raw.args === 'object' && !raw.operation) {
      const nested = raw.args as Record<string, unknown>
      normalizedPayload = { ...nested, ...raw, args: undefined }
    }
  }

  let args: unknown
  try {
    args = tool.inputSchema
      ? tool.inputSchema.parse(normalizedPayload)
      : validateGeneratedToolPayload(toolName, 'parameters', normalizedPayload)
  } catch (error) {
    if (!isZodError(error)) throw error
    const field = error.issues[0]?.path.join('.') || 'input'
    throw new OrchestrationError('validation', `${field}: ${getValidationErrorMessage(error)}`)
  }

  assertServerToolNotAborted(context, `User stop signal aborted ${toolName} after validation`)
  if (tool.writes?.(args)) {
    // A workspace run's permission can sit below its principal's live role (an unattributed inbox
    // message runs as the owner, capped to read), and the operations behind these tools authorize
    // that live role, so the cap is enforced here. An organization chat carries no workspace cap.
    if (
      !context?.organizationId &&
      !context?.chatOrganizationId &&
      !copilotToolCanWrite(context?.userPermission)
    ) {
      const { operation, action } = args as { operation?: unknown; action?: unknown }
      // Classified so the projection surfaces it: a permission denial is
      // caller-actionable (stop retrying, tell the user), not a system error.
      throw new OrchestrationError(
        'forbidden',
        copilotWriteDeniedMessage(
          toolName,
          toStringOrNull(operation ?? action),
          context?.userPermission
        )
      )
    }
    requireDelegatedApiScope(OAUTH_API_WRITE_SCOPE)
  }

  // Execute. None of the remaining tools resolve blocks or gate discovery, so the old
  // custom-block-overlay / block-visibility ALS scopes are gone with the tools that
  // needed them (workflow authoring now flows through the CLI + v2 surface).
  const result = await tool.execute(args, context)

  // Validate output if tool declares a schema; otherwise fall back to the
  // generated JSON schema contract emitted from Go.
  return tool.outputSchema
    ? tool.outputSchema.parse(result)
    : validateGeneratedToolPayload(toolName, 'resultSchema', result)
}
