import type { DataPart, FilePart, Message, Part, Task, TextPart } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createA2AClient, extractTextContent, isTerminalState } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('A2ASendMessageAPI')

const FileInputSchema = z.object({
  type: z.enum(['file', 'url']),
  data: z.string(),
  name: z.string(),
  mime: z.string().optional(),
})

const A2ASendMessageSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  message: z.string().min(1, 'Message is required'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  data: z.string().optional(),
  files: z.array(FileInputSchema).optional(),
  apiKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized A2A send message attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated A2A send message request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = A2ASendMessageSchema.parse(body)

    logger.info(`[${requestId}] Sending A2A message`, {
      agentUrl: validatedData.agentUrl,
      hasTaskId: !!validatedData.taskId,
      hasContextId: !!validatedData.contextId,
    })

    let client
    try {
      client = await createA2AClient(validatedData.agentUrl, validatedData.apiKey)
      logger.info(`[${requestId}] A2A client created successfully`)
    } catch (clientError) {
      logger.error(`[${requestId}] Failed to create A2A client:`, clientError)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to connect to agent: ${clientError instanceof Error ? clientError.message : 'Unknown error'}`,
        },
        { status: 502 }
      )
    }

    const parts: Part[] = []

    const textPart: TextPart = { kind: 'text', text: validatedData.message }
    parts.push(textPart)

    if (validatedData.data) {
      try {
        const parsedData = JSON.parse(validatedData.data)
        const dataPart: DataPart = { kind: 'data', data: parsedData }
        parts.push(dataPart)
      } catch (parseError) {
        logger.warn(`[${requestId}] Failed to parse data as JSON, skipping DataPart`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
        })
      }
    }

    if (validatedData.files && validatedData.files.length > 0) {
      for (const file of validatedData.files) {
        if (file.type === 'url') {
          const urlValidation = await validateUrlWithDNS(file.data, 'fileUrl')
          if (!urlValidation.isValid) {
            return NextResponse.json(
              { success: false, error: urlValidation.error },
              { status: 400 }
            )
          }

          const filePart: FilePart = {
            kind: 'file',
            file: {
              name: file.name,
              mimeType: file.mime,
              uri: file.data,
            },
          }
          parts.push(filePart)
        } else if (file.type === 'file') {
          let bytes = file.data
          let mimeType = file.mime

          if (file.data.startsWith('data:')) {
            const match = file.data.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              mimeType = mimeType || match[1]
              bytes = match[2]
            } else {
              bytes = file.data
            }
          }

          const filePart: FilePart = {
            kind: 'file',
            file: {
              name: file.name,
              mimeType: mimeType || 'application/octet-stream',
              bytes,
            },
          }
          parts.push(filePart)
        }
      }
    }

    const message: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'user',
      parts,
      ...(validatedData.taskId && { taskId: validatedData.taskId }),
      ...(validatedData.contextId && { contextId: validatedData.contextId }),
    }

    let result
    try {
      result = await client.sendMessage({ message })
      logger.info(`[${requestId}] A2A sendMessage completed`, { resultKind: result?.kind })
    } catch (sendError) {
      logger.error(`[${requestId}] Failed to send A2A message:`, sendError)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to send message: ${sendError instanceof Error ? sendError.message : 'Unknown error'}`,
        },
        { status: 502 }
      )
    }

    if (result.kind === 'message') {
      const responseMessage = result as Message

      logger.info(`[${requestId}] A2A message sent successfully (message response)`)

      return NextResponse.json({
        success: true,
        output: {
          content: extractTextContent(responseMessage),
          taskId: responseMessage.taskId || '',
          contextId: responseMessage.contextId,
          state: 'completed',
        },
      })
    }

    const task = result as Task
    const lastAgentMessage = task.history?.filter((m) => m.role === 'agent').pop()
    const content = lastAgentMessage ? extractTextContent(lastAgentMessage) : ''

    logger.info(`[${requestId}] A2A message sent successfully (task response)`, {
      taskId: task.id,
      state: task.status.state,
    })

    return NextResponse.json({
      success: isTerminalState(task.status.state) && task.status.state !== 'failed',
      output: {
        content,
        taskId: task.id,
        contextId: task.contextId,
        state: task.status.state,
        artifacts: task.artifacts,
        history: task.history,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error sending A2A message:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
