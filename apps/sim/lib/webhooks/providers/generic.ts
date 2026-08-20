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
import { isProviderConfigFlagEnabled, verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Generic')

/**
 * `providerConfig` flags, set by the matching `switch` subBlocks on the generic webhook trigger.
 *
 * Both default to off, so every webhook deployed before these existed keeps its current behavior:
 * `POST` only, and a workflow input that is exactly the request body.
 */
const ACCEPT_OTHER_METHODS_FLAG = 'acceptOtherMethods'
const EXPOSE_REQUEST_HEADERS_FLAG = 'exposeRequestHeaders'

/**
 * Headers withheld from the workflow input because they carry credentials. Exposing one would
 * copy the secret into execution logs and trace spans, where it outlives the request.
 *
 * A denylist rather than an allowlist, because arbitrary custom headers being usable is the point
 * of the feature. A denylist is leaky by construction, so it is not the only defense: the
 * webhook's own token is withheld by value as well as by name, and the whole feature is off
 * unless the webhook owner turns it on.
 */
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'authentication',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
  'cookie',
  'set-cookie',
  'api-key',
  'apikey',
  'x-api-key',
  'x-apikey',
  'x-api-token',
  'x-auth-token',
  'x-auth-key',
  'x-access-token',
  'x-secret',
  'x-secret-key',
  'x-token',
  'x-functions-key',
  'x-amz-security-token',
  'x-goog-api-key',
  'x-csrf-token',
  'x-xsrf-token',
  'x-sim-idempotency-key',
])

/** Shortest token still worth matching header values against; below this, collisions dominate. */
const MIN_TOKEN_MATCH_LENGTH = 8

/**
 * Request headers for the workflow input, minus the ones that carry credentials.
 *
 * Names are matched against a fixed denylist plus the webhook's own `secretHeaderName`. Values
 * are matched against the webhook's own token, which catches a sender that repeats the token in
 * a header this list has never heard of — the failure mode a denylist cannot avoid on its own.
 */
function exposedHeaders(
  headers: Record<string, string>,
  providerConfig: Record<string, unknown>
): Record<string, string> {
  const secretHeaderName = providerConfig.secretHeaderName
  const withheldName =
    typeof secretHeaderName === 'string' ? secretHeaderName.toLowerCase() : undefined

  const token = providerConfig.token
  const withheldValue =
    typeof token === 'string' && token.length >= MIN_TOKEN_MATCH_LENGTH ? token : undefined

  const exposed: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (CREDENTIAL_HEADER_NAMES.has(lowerName) || lowerName === withheldName) continue
    if (withheldValue !== undefined && value.includes(withheldValue)) continue
    exposed[lowerName] = value
  }

  return exposed
}

/**
 * Merge request metadata into the body under reserved keys. The body keeps precedence per key,
 * so a payload that already carries a field of that name resolves exactly as it did before.
 *
 * Both drop paths log at debug: each fires once per delivery for a webhook whose shape simply is
 * that way (an array body, a body with its own `headers` field), so a warning would be a
 * per-request stream about a steady state rather than a signal.
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
    logger.debug(
      `[${requestId}] Dropping webhook request metadata: the body is not an object, so there is no field to merge it into`,
      { keys: entries.map(([key]) => key) }
    )
    return body
  }

  const merged: Record<string, unknown> = { ...body }

  for (const [key, value] of entries) {
    if (Object.hasOwn(body, key)) {
      logger.debug(
        `[${requestId}] Dropping webhook ${key}: the body already defines a "${key}" field`
      )
      continue
    }
    merged[key] = value
  }

  return merged
}

export const genericHandler: WebhookProviderHandler = {
  extraDeliveryMethods: {
    methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
    enabledBy: ACCEPT_OTHER_METHODS_FLAG,
  },

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
   * Expose request metadata under reserved `method`, `query` and `headers` keys alongside the
   * body fields. Each key appears only when it carries information the webhook owner asked for:
   *
   * - `query` whenever the URL has parameters, which are otherwise silently dropped — the bug
   *   this exists to fix. It is not gated, because it is the caller's own URL and adds nothing
   *   to a request that has no query string.
   * - `method` only once the webhook accepts more than `POST`; before that it is the constant
   *   `"POST"`, so emitting it would change every existing payload to say nothing.
   * - `headers` only once the webhook opts in, because they land in execution logs and trace
   *   spans, where they outlive the request.
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

    const exposesMethod = isProviderConfigFlagEnabled(providerConfig[ACCEPT_OTHER_METHODS_FLAG])
    const exposesHeaders = isProviderConfigFlagEnabled(providerConfig[EXPOSE_REQUEST_HEADERS_FLAG])

    return {
      input: mergeRequestData(
        body,
        {
          ...(exposesMethod ? { method } : {}),
          query,
          ...(exposesHeaders ? { headers: exposedHeaders(headers, providerConfig) } : {}),
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
