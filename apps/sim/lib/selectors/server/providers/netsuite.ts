import { isPlainRecord } from '@sim/utils/object'
import { NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { executeNetsuiteGetAsyncStatusOperation } from '@/lib/internal/netsuite/operations/get-async-status'
import { executeNetsuiteListRecordTypesOperation } from '@/lib/internal/netsuite/operations/list-record-types'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { definePreparedSelectorAttachment } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import type { NetSuiteAuthParams } from '@/tools/netsuite/types'
import { normalizeSuiteTalkUrl } from '@/tools/netsuite/utils'
import type { ToolResponse } from '@/tools/types'

type NetSuiteSelectorKey = Extract<
  ServerSelectorKey,
  'netsuite.recordTypes' | 'netsuite.asyncTasks'
>

type NetSuiteSelectorKind = 'record_types' | 'async_tasks'
type PreparedNetSuiteDestination = NetSuiteAuthParams & { instanceUrl: string }

const NETSUITE_SELECTOR_KIND = {
  'netsuite.recordTypes': 'record_types',
  'netsuite.asyncTasks': 'async_tasks',
} as const satisfies Record<NetSuiteSelectorKey, NetSuiteSelectorKind>

const MAX_RECORD_TYPES = 1_000
const MAX_ASYNC_TASKS = 100
const MAX_ID_LENGTH = 512

interface NetSuiteSelectorObject {
  id: string
  label: string
  detail: string | null
}

function requireString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new SelectorOptionsUnavailableError()
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new SelectorOptionsUnavailableError()
  return normalized
}

function requireItems(data: unknown): Record<string, unknown>[] {
  if (!isPlainRecord(data) || !Array.isArray(data.items) || !data.items.every(isPlainRecord)) {
    throw new SelectorOptionsUnavailableError()
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
  for (const item of requireItems(data)) {
    const name = requireString(item.name, MAX_ID_LENGTH)
    if (names.has(name)) continue
    if (names.size >= MAX_RECORD_TYPES) throw new SelectorOptionsUnavailableError()
    names.add(name)
    objects.push({ id: name, label: name, detail: null })
  }
  return dedupeAndSort(objects)
}

function taskIdFromHref(href: unknown, origin: string, jobId: string): string {
  const hrefValue = requireString(href, 4_096)
  let url: URL
  try {
    url = new URL(hrefValue, origin)
  } catch {
    throw new SelectorOptionsUnavailableError()
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new SelectorOptionsUnavailableError()
  }

  const match = url.pathname.match(/^\/services\/rest\/async\/v1\/job\/([^/]+)\/task\/([^/]+)$/)
  if (!match?.[1] || !match[2]) throw new SelectorOptionsUnavailableError()

  let linkedJobId: string
  let taskId: string
  try {
    linkedJobId = decodeURIComponent(match[1])
    taskId = decodeURIComponent(match[2])
  } catch {
    throw new SelectorOptionsUnavailableError()
  }
  if (linkedJobId !== jobId || !taskId || taskId.length > MAX_ID_LENGTH) {
    throw new SelectorOptionsUnavailableError()
  }

  const canonicalPath = `/services/rest/async/v1/job/${encodeURIComponent(linkedJobId)}/task/${encodeURIComponent(taskId)}`
  if (
    url.pathname !== canonicalPath ||
    (hrefValue !== canonicalPath && hrefValue !== `${origin}${canonicalPath}`)
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  return taskId
}

function normalizeAsyncTasks(
  data: unknown,
  instanceUrl: string,
  jobId: string
): NetSuiteSelectorObject[] {
  const origin = normalizeSuiteTalkUrl(instanceUrl)
  const objects = new Map<string, NetSuiteSelectorObject>()
  for (const item of requireItems(data)) {
    if (!Array.isArray(item.links) || item.links.length === 0 || !item.links.every(isPlainRecord)) {
      throw new SelectorOptionsUnavailableError()
    }
    const selfLinks = item.links.filter((link) => link.rel === 'self')
    if (selfLinks.length === 0) throw new SelectorOptionsUnavailableError()
    for (const link of selfLinks) {
      const id = taskIdFromHref(link.href, origin, jobId)
      if (objects.has(id)) continue
      if (objects.size >= MAX_ASYNC_TASKS) throw new SelectorOptionsUnavailableError()
      objects.set(id, { id, label: id, detail: null })
    }
  }
  return dedupeAndSort([...objects.values()])
}

function requireJobId(args: ExecuteServerSelectorArgs): string {
  const jobId = args.context.jobId?.trim()
  if (!jobId || jobId.length > MAX_ID_LENGTH) throw new SelectorContextUnavailableError()
  return jobId
}

async function requireNetSuiteServiceAccount(args: ExecuteServerSelectorArgs): Promise<string> {
  const credential = args.credential
  const access = credential?.access
  if (!credential || !access?.resolvedCredentialId || access.credentialType !== 'service_account') {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  return access.resolvedCredentialId
}

async function prepareNetSuiteDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedNetSuiteDestination> {
  const resolvedCredentialId = await requireNetSuiteServiceAccount(args)
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  let instanceUrl: string
  try {
    instanceUrl = normalizeSuiteTalkUrl(token.instanceUrl)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  return {
    oauthCredential: resolvedCredentialId,
    accessToken: token.accessToken,
    instanceUrl,
  }
}

async function executeDiscoveryTool(
  kind: NetSuiteSelectorKind,
  args: ExecuteServerSelectorArgs,
  auth: NetSuiteAuthParams,
  jobId?: string
): Promise<ToolResponse> {
  if (args.signal?.aborted) throw args.signal.reason
  if (kind === 'record_types') {
    return executeNetsuiteListRecordTypesOperation(auth, args.signal)
  }
  if (!jobId) throw new SelectorOptionsUnavailableError()
  return executeNetsuiteGetAsyncStatusOperation({ ...auth, jobId, view: 'tasks' }, args.signal)
}

function toOptions(objects: NetSuiteSelectorObject[]): SafeSelectorOption[] {
  return objects.map((object) => ({
    id: object.id,
    label: object.label,
    ...(object.detail ? { meta: { detail: object.detail } } : {}),
  }))
}

async function executeNetSuite(args: ExecuteServerSelectorArgs, auth: PreparedNetSuiteDestination) {
  const kind = NETSUITE_SELECTOR_KIND[args.selectorKey as NetSuiteSelectorKey]
  if (!kind) throw new SelectorOptionsUnavailableError()
  const jobId = kind === 'async_tasks' ? requireJobId(args) : undefined
  const result = await executeDiscoveryTool(kind, args, auth, jobId)
  if (!result.success) {
    const status = result.output.status
    throw selectorProviderStatusError(Number.isInteger(status) ? status : 502)
  }
  const objects =
    kind === 'record_types'
      ? normalizeRecordTypes(result.output.data)
      : normalizeAsyncTasks(result.output.data, auth.instanceUrl, jobId as string)
  return flatSelectorResult(args.request, toOptions(objects), true)
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['netsuite'],
} as const

export const netsuiteSelectorAttachments = {
  'netsuite.recordTypes': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareNetSuiteDestination },
    execute: executeNetSuite,
  }),
  'netsuite.asyncTasks': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareNetSuiteDestination },
    execute: executeNetSuite,
  }),
} satisfies ServerSelectorAttachmentMap<NetSuiteSelectorKey>
