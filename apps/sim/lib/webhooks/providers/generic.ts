import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/core/utils/request'
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

/**
 * Headers withheld from the workflow input because they carry credentials. Exposing one would
 * copy the secret into execution logs and trace spans, where it outlives the request. The
 * webhook's own `secretHeaderName` is withheld on top of this list, per webhook.
 *
 * A denylist rather than an allowlist, because arbitrary custom headers being usable is the
 * point of the feature.
 */
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-sim-idempotency-key',
])

/** Request headers for the workflow input, minus the ones that carry credentials. */
function exposedHeaders(
  headers: Record<string, string>,
  secretHeaderName?: string
): Record<string, string> {
  const withheld = secretHeaderName?.toLowerCase()
  const exposed: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (CREDENTIAL_HEADER_NAMES.has(lowerName) || lowerName === withheld) continue
    exposed[lowerName] = value
  }

  return exposed
}

/**
 * Merge request metadata into the body under reserved keys. The body keeps precedence per key,
 * so a payload that already carries a field of that name resolves exactly as it did before.
 */
function mergeRequestData(
  body: unknown,
  requestData: Record<string, string | Record<string, string>>,
  requestId: string
): unknown {
  const entries = Object.entries(requestData).filter(([, value]) =>
    typeof value === 'string' ? value.length > 0 : Object.keys(value).length > 0
  )

  if (entries.length === 0) {
    return body
  }

  if (!isRecordLike(body)) {
    logger.warn(
      `[${requestId}] Dropping webhook request metadata: the body is not an object, so there is no field to merge it into`,
      { keys: entries.map(([key]) => key) }
    )
    return body
  }

  const merged: Record<string, unknown> = { ...body }

  for (const [key, value] of entries) {
    if (key in body) {
      logger.warn(
        `[${requestId}] Dropping webhook ${key}: the body already defines a "${key}" field`
      )
      continue
    }
    merged[key] = value
  }

  return merged
}

export const genericHandler: WebhookProviderHandler = {
  extraDeliveryMethods: ['GET', 'PUT', 'PATCH', 'DELETE'],

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
      const clientIp = getClientIp(request)

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

  /**
   * Expose the request method, query parameters and headers under reserved `method`, `query` and
   * `headers` keys alongside the body fields.
   */
  async formatInput({
    body,
    headers,
    query,
    method,
    webhook,
    requestId,
  }: FormatInputContext): Promise<FormatInputResult> {
    const providerConfig = (webhook.providerConfig as Record<string, unknown> | null) ?? {}

    return {
      input: mergeRequestData(
        body,
        {
          method,
          query,
          headers: exposedHeaders(headers, providerConfig.secretHeaderName as string | undefined),
        },
        requestId
      ),
    }
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
