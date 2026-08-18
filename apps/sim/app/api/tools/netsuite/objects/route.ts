import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type NetSuiteObjectsSelectorBody,
  netsuiteObjectsSelectorContract,
} from '@/lib/api/contracts/selectors/netsuite'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { resolveCredentialAccessToken, resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { netsuiteGetAsyncStatusTool } from '@/tools/netsuite/get_async_status'
import { netsuiteListRecordTypesTool } from '@/tools/netsuite/list_record_types'
import type { NetSuiteAuthParams } from '@/tools/netsuite/types'
import { normalizeSuiteTalkUrl } from '@/tools/netsuite/utils'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('NetSuiteObjectsAPI')

export const dynamic = 'force-dynamic'

/**
 * This session/internal-only metadata route intentionally has no separate rate
 * limiter: it reuses read-only NetSuite tools whose deadlines and bounded
 * result sets constrain each provider call, matching Snowflake's picker route.
 */
const SELECTOR_REQUEST_MAX_BYTES = 16 * 1024
const MAX_RECORD_TYPES = 1_000
const MAX_ASYNC_TASKS = 100
const MAX_ID_LENGTH = 512

interface NetSuiteSelectorObject {
  id: string
  label: string
  detail: string | null
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('NetSuite selector request was cancelled', 'AbortError')
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`NetSuite returned an invalid ${label}`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new Error(`NetSuite returned an oversized ${label}`)
  }
  return normalized
}

function requireItems(data: unknown, label: string): Record<string, unknown>[] {
  if (!isPlainRecord(data) || !Array.isArray(data.items)) {
    throw new Error(`NetSuite returned an invalid ${label} response`)
  }
  if (!data.items.every(isPlainRecord)) {
    throw new Error(`NetSuite returned malformed ${label} entries`)
  }
  return data.items
}

function dedupeAndSort(objects: NetSuiteSelectorObject[]): NetSuiteSelectorObject[] {
  const unique = new Map<string, NetSuiteSelectorObject>()
  for (const object of objects) {
    if (!unique.has(object.id)) unique.set(object.id, object)
  }
  return [...unique.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
  )
}

function normalizeRecordTypes(data: unknown): NetSuiteSelectorObject[] {
  const objects: NetSuiteSelectorObject[] = []
  const names = new Set<string>()
  for (const item of requireItems(data, 'record-type catalog')) {
    const name = requireString(item.name, 'record type name', MAX_ID_LENGTH)
    if (!names.has(name)) {
      if (names.size >= MAX_RECORD_TYPES) {
        throw new Error('NetSuite returned too many record types')
      }
      names.add(name)
      objects.push({ id: name, label: name, detail: null })
    }
  }
  return dedupeAndSort(objects)
}

function taskIdFromHref(href: unknown, origin: string, jobId: string): string {
  const hrefValue = requireString(href, 'asynchronous task link', 4_096)
  let url: URL
  try {
    url = new URL(hrefValue, origin)
  } catch {
    throw new Error('NetSuite returned a malformed task link')
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('NetSuite returned an unsafe task link')
  }

  const match = url.pathname.match(/^\/services\/rest\/async\/v1\/job\/([^/]+)\/task\/([^/]+)$/)
  if (!match?.[1] || !match[2]) {
    throw new Error('NetSuite returned an unexpected task link')
  }

  let linkedJobId: string
  let taskId: string
  try {
    linkedJobId = decodeURIComponent(match[1])
    taskId = decodeURIComponent(match[2])
  } catch {
    throw new Error('NetSuite returned a malformed task link')
  }
  if (linkedJobId !== jobId || !taskId || taskId.length > MAX_ID_LENGTH) {
    throw new Error('NetSuite returned a task link outside the requested job')
  }

  const canonicalPath = `/services/rest/async/v1/job/${encodeURIComponent(linkedJobId)}/task/${encodeURIComponent(taskId)}`
  if (
    url.pathname !== canonicalPath ||
    (hrefValue !== canonicalPath && hrefValue !== `${origin}${canonicalPath}`)
  ) {
    throw new Error('NetSuite returned a noncanonical task link')
  }
  return taskId
}

function normalizeAsyncTasks(
  data: unknown,
  instanceUrl: string,
  jobId: string
): NetSuiteSelectorObject[] {
  const items = requireItems(data, 'asynchronous task collection')
  const origin = normalizeSuiteTalkUrl(instanceUrl)
  const objects = new Map<string, NetSuiteSelectorObject>()

  for (const item of items) {
    if (!Array.isArray(item.links) || item.links.length === 0 || !item.links.every(isPlainRecord)) {
      throw new Error('NetSuite returned malformed asynchronous task links')
    }
    // Oracle documents a `self` link per task but never guarantees it is the
    // only relationship on the entry, so additional rels are skipped rather
    // than failing the whole picker.
    const selfLinks = item.links.filter((link) => link.rel === 'self')
    if (selfLinks.length === 0) {
      throw new Error('NetSuite returned an asynchronous task without a self link')
    }
    for (const link of selfLinks) {
      const id = taskIdFromHref(link.href, origin, jobId)
      if (!objects.has(id)) {
        if (objects.size >= MAX_ASYNC_TASKS) {
          throw new Error('NetSuite returned too many asynchronous tasks')
        }
        objects.set(id, { id, label: id, detail: null })
      }
    }
  }
  return dedupeAndSort([...objects.values()])
}

async function executeDiscoveryTool(
  body: NetSuiteObjectsSelectorBody,
  auth: NetSuiteAuthParams,
  signal: AbortSignal
): Promise<ToolResponse> {
  throwIfAborted(signal)
  switch (body.kind) {
    case 'record_types': {
      const execute = netsuiteListRecordTypesTool.directExecution
      if (!execute) throw new Error('NetSuite record-type tool is not executable')
      return execute(auth, signal)
    }
    case 'async_tasks': {
      const execute = netsuiteGetAsyncStatusTool.directExecution
      if (!execute) throw new Error('NetSuite asynchronous-status tool is not executable')
      return execute({ ...auth, jobId: body.jobId, view: 'tasks' }, signal)
    }
  }
}

function failedDiscoveryResponse(result: ToolResponse): NextResponse {
  const providerStatus =
    typeof result.output.status === 'number' && Number.isInteger(result.output.status)
      ? result.output.status
      : 0
  if (providerStatus === 401) {
    return NextResponse.json(
      {
        error: 'NetSuite rejected this credential. Reconnect it and try again.',
        authRequired: true,
      },
      { status: 401 }
    )
  }
  if (providerStatus === 403) {
    return NextResponse.json(
      { error: 'NetSuite denied access to object discovery for this credential.' },
      { status: 403 }
    )
  }
  if (providerStatus >= 400 && providerStatus < 500) {
    return NextResponse.json(
      { error: 'NetSuite could not list objects for this request.' },
      { status: 400 }
    )
  }
  return NextResponse.json({ error: 'NetSuite object discovery failed.' }, { status: 502 })
}

function credentialFailureResponse(error: unknown): NextResponse {
  if (error instanceof TokenServiceAccountValidationError) {
    if (error.code !== 'provider_unavailable') {
      return NextResponse.json(
        {
          error: 'Could not resolve the NetSuite credential. Reconnect it and try again.',
          authRequired: true,
        },
        { status: 401 }
      )
    }
    return NextResponse.json(
      { error: 'The NetSuite credential service is temporarily unavailable.' },
      { status: 502 }
    )
  }
  return NextResponse.json(
    {
      error: 'Could not resolve the NetSuite credential. Reconnect it and try again.',
      authRequired: true,
    },
    { status: 401 }
  )
}

/**
 * Lists the bounded NetSuite objects used by the block's record-type and
 * asynchronous-task pickers. Like Snowflake's selector endpoint, this
 * route owns authentication, credential resolution, provider access, and
 * response normalization directly; short-lived tokens never reach the client.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const caller = await checkSessionOrInternalAuth(request, { requireWorkflowId: true })
  if (!caller.success || !caller.userId) {
    return NextResponse.json({ error: caller.error || 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(
    netsuiteObjectsSelectorContract,
    request,
    {},
    {
      maxBodyBytes: SELECTOR_REQUEST_MAX_BYTES,
      validationErrorResponse: (error) =>
        NextResponse.json(
          { error: getValidationErrorMessage(error, 'Invalid request') },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response
  const body = parsed.data.body
  const { credential, workflowId, kind } = body

  const authorization = await authorizeCredentialUse(request, {
    credentialId: credential,
    workflowId,
    callerUserId: caller.userId,
  })
  if (!authorization.ok || !authorization.credentialOwnerUserId) {
    return NextResponse.json({ error: authorization.error || 'Unauthorized' }, { status: 403 })
  }

  const resolvedCredentialId = authorization.resolvedCredentialId ?? credential
  const resolvedCredential = await resolveOAuthAccountId(resolvedCredentialId)
  if (
    authorization.credentialType !== 'service_account' ||
    resolvedCredential?.credentialType !== 'service_account' ||
    resolvedCredential.providerId !== NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    return NextResponse.json(
      { error: 'Select a NetSuite client-credentials service account.' },
      { status: 400 }
    )
  }

  throwIfAborted(request.signal)
  let token
  try {
    token = await resolveCredentialAccessToken(
      resolvedCredentialId,
      authorization.credentialOwnerUserId,
      requestId
    )
  } catch (error) {
    throwIfAborted(request.signal)
    logger.warn('Failed to resolve NetSuite selector credential', {
      credentialId: resolvedCredentialId,
      kind,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    if (error instanceof TokenServiceAccountValidationError) {
      return credentialFailureResponse(error)
    }
    throw error
  }
  throwIfAborted(request.signal)
  if (!token?.accessToken || !token.instanceUrl) {
    return credentialFailureResponse(null)
  }

  const auth: NetSuiteAuthParams = {
    oauthCredential: resolvedCredentialId,
    accessToken: token.accessToken,
    instanceUrl: token.instanceUrl,
  }

  const result: ToolResponse = await executeDiscoveryTool(body, auth, request.signal)
  throwIfAborted(request.signal)
  if (!result.success) return failedDiscoveryResponse(result)

  try {
    const data = result.output.data as unknown
    const objects =
      body.kind === 'record_types'
        ? normalizeRecordTypes(data)
        : normalizeAsyncTasks(data, token.instanceUrl, body.jobId)
    return NextResponse.json({ objects })
  } catch (error) {
    logger.error('NetSuite selector response was invalid', {
      credentialId: resolvedCredentialId,
      kind,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json(
      { error: 'NetSuite returned an invalid object-discovery response.' },
      { status: 502 }
    )
  }
})
