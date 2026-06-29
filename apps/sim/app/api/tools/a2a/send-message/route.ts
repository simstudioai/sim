import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type A2AFileInput,
  buildUserMessage,
  createA2AClient,
  isTaskResult,
  messageOutput,
  taskErrored,
  taskOutput,
} from '@/lib/a2a/client'
import { a2aSendMessageContract } from '@/lib/api/contracts/tools/a2a'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { enforceUserOrIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

/** Blocking sends wait until the agent reaches a terminal/interrupted state. */
export const maxDuration = 300

/** Per-file cap on attachments resolved from storage. */
const A2A_MAX_FILE_BYTES = 10 * 1024 * 1024

const logger = createLogger('A2ASendMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const rateLimited = await enforceUserOrIpRateLimit('a2a-send-message', auth.userId, request)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(
    a2aSendMessageContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response
  const body = parsed.data.body

  let data: unknown
  if (body.data !== undefined) {
    if (typeof body.data === 'string') {
      try {
        data = JSON.parse(body.data)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Data must be valid JSON' },
          { status: 400 }
        )
      }
    } else {
      data = body.data
    }
  }

  try {
    let files: A2AFileInput[] | undefined
    if (body.files?.length) {
      if (!auth.userId) {
        return NextResponse.json(
          { success: false, error: 'Authentication required to attach files' },
          { status: 401 }
        )
      }
      const userFiles = processFilesToUserFiles(body.files, requestId, logger)
      for (const userFile of userFiles) {
        const denied = await assertToolFileAccess(userFile.key, auth.userId, requestId, logger)
        if (denied) return denied
      }
      files = await Promise.all(
        userFiles.map(async (userFile) => ({
          bytes: await downloadFileFromStorage(userFile, requestId, logger, {
            maxBytes: A2A_MAX_FILE_BYTES,
          }),
          name: userFile.name,
          mediaType: userFile.type || 'application/octet-stream',
        }))
      )
    }

    const client = await createA2AClient(body.agentUrl, body.apiKey, { signal: request.signal })
    const message = buildUserMessage({
      text: body.message,
      data,
      files,
      taskId: body.taskId,
      contextId: body.contextId,
    })

    const result = await client.sendMessage({
      tenant: '',
      message,
      configuration: undefined,
      metadata: undefined,
    })

    if (!isTaskResult(result)) {
      logger.info(`[${requestId}] A2A send returned a direct message`)
      return NextResponse.json({ success: true, output: messageOutput(result) })
    }

    const output = taskOutput(result)
    const errored = taskErrored(result)
    logger.info(`[${requestId}] A2A send produced task ${result.id} (${output.state})`)
    return NextResponse.json({
      success: !errored,
      ...(errored ? { error: output.content || `Agent task ${output.state}` } : {}),
      output,
    })
  } catch (error) {
    logger.error(`[${requestId}] A2A send failed`, { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 502 })
  }
})
