import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  ProcessFilesContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Generic')

export const genericHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token as string | undefined
      if (!configToken) {
        return new NextResponse('Unauthorized - Authentication required but no token configured', {
          status: 401,
        })
      }

      const secretHeaderName = providerConfig.secretHeaderName as string | undefined
      if (!verifyTokenAuth(request, configToken, secretHeaderName)) {
        return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
      }
    }

    const allowedIps = providerConfig.allowedIps
    if (allowedIps && Array.isArray(allowedIps) && allowedIps.length > 0) {
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      if (clientIp === 'unknown' || !allowedIps.includes(clientIp)) {
        logger.warn(`[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`)
        return new NextResponse('Forbidden - IP not allowed', {
          status: 403,
        })
      }
    }

    return null
  },

  enrichHeaders({ body, providerConfig }: EventFilterContext, headers: Record<string, string>) {
    const idempotencyField = providerConfig.idempotencyField as string | undefined
    if (idempotencyField && body) {
      const value = idempotencyField
        .split('.')
        .reduce(
          (acc: unknown, key: string) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
          body
        )
      if (value !== undefined && value !== null && typeof value !== 'object') {
        headers['x-sim-idempotency-key'] = String(value)
      }
    }
  },

  formatSuccessResponse(providerConfig: Record<string, unknown>) {
    if (providerConfig.responseMode === 'custom') {
      const rawCode = Number(providerConfig.responseStatusCode) || 200
      const statusCode = rawCode >= 100 && rawCode <= 599 ? rawCode : 200
      const responseBody = (providerConfig.responseBody as string | undefined)?.trim()

      if (!responseBody) {
        return new NextResponse(null, { status: statusCode })
      }

      try {
        const parsed = JSON.parse(responseBody)
        return NextResponse.json(parsed, { status: statusCode })
      } catch {
        return new NextResponse(responseBody, {
          status: statusCode,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },

  async processInputFiles({
    input,
    blocks,
    blockId,
    workspaceId,
    workflowId,
    executionId,
    requestId,
    userId,
  }: ProcessFilesContext) {
    const triggerBlock = blocks[blockId] as Record<string, unknown> | undefined
    const subBlocks = triggerBlock?.subBlocks as Record<string, unknown> | undefined
    const inputFormatBlock = subBlocks?.inputFormat as Record<string, unknown> | undefined

    if (inputFormatBlock?.value) {
      const inputFormat = inputFormatBlock.value as Array<{
        name: string
        type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]'
      }>

      const fileFields = inputFormat.filter((field) => field.type === 'file[]')

      if (fileFields.length > 0) {
        const { processExecutionFiles } = await import('@/lib/execution/files')
        const executionContext = {
          workspaceId,
          workflowId,
          executionId,
        }

        for (const fileField of fileFields) {
          const fieldValue = input[fileField.name]

          if (fieldValue && typeof fieldValue === 'object') {
            const uploadedFiles = await processExecutionFiles(
              fieldValue,
              executionContext,
              requestId,
              userId
            )

            if (uploadedFiles.length > 0) {
              input[fileField.name] = uploadedFiles
              logger.info(
                `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
              )
            }
          }
        }
      }
    }
  },
}
