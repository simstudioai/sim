import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  Ffmpeg,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
} from '@/lib/mothership/generated/tool-catalog-v1'
import { copilotToolCanWrite } from '@/lib/mothership/tools/permissions'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'
import { searchDocsServerTool } from '@/lib/mothership/tools/server/docs/search-docs'
import { validateGeneratedToolPayload } from '@/lib/mothership/tools/server/generated-schema'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { ffmpegServerTool } from '@/lib/mothership/tools/server/media/ffmpeg'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { getCredentialsServerTool } from '@/lib/mothership/tools/server/user/get-credentials'

export type ExecuteResponseSuccess = z.output<typeof ExecuteResponseSuccessSchema>

const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const logger = createLogger('ServerToolRouter')

const WRITE_ACTIONS: Record<string, string[]> = {
  [GenerateImage.id]: ['generate'],
  [GenerateVideo.id]: ['generate'],
  [GenerateAudio.id]: ['generate'],
  [Ffmpeg.id]: ['*'],
}

function isWriteAction(toolName: string, action: string | undefined): boolean {
  const writeActions = WRITE_ACTIONS[toolName]
  if (!writeActions) return false
  // '*' means the tool is always a write operation regardless of action field
  if (writeActions.includes('*')) return true
  return Boolean(action && writeActions.includes(action))
}

/** Registry of all server tools. Tools self-declare their validation schemas. */
const baseServerToolRegistry: Record<string, BaseServerTool> = {
  [searchDocsServerTool.name]: searchDocsServerTool,
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

  // Action-level permission enforcement for mixed read/write tools
  if (WRITE_ACTIONS[toolName]) {
    const p = payload as Record<string, unknown>
    const action = (p?.operation ?? p?.action) as string | undefined
    if (isWriteAction(toolName, action) && !copilotToolCanWrite(context?.userPermission)) {
      const actionLabel = action ? `'${action}' on ` : ''
      // Classified so the projection surfaces it: a permission denial is
      // caller-actionable (stop retrying, tell the user), not a system error.
      throw new OrchestrationError(
        'forbidden',
        `Permission denied: ${actionLabel}${toolName} requires write access. You have '${context?.userPermission ?? 'none'}' permission.`
      )
    }
  }

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

  const args = tool.inputSchema
    ? tool.inputSchema.parse(normalizedPayload)
    : validateGeneratedToolPayload(toolName, 'parameters', normalizedPayload)

  assertServerToolNotAborted(context, `User stop signal aborted ${toolName} after validation`)

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
