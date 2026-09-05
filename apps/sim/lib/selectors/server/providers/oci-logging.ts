import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciLoggingOperation,
  OCI_LOGGING_MANAGEMENT_POLICY,
  OCI_LOGGING_SERVICE_ID,
  type OciLoggingDestination,
} from '@/lib/internal/oci-logging/operations'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { OciLog, OciLogGroup } from '@/tools/oci_logging/types'

type OciLoggingSelectorKey = Extract<
  ServerSelectorKey,
  'oci_logging.logGroups' | 'oci_logging.logs' | 'oci_logging.customLogs'
>

function requireId(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized || normalized.length > 255) throw new SelectorContextUnavailableError()
  return normalized
}

async function prepareDestination(args: ExecuteServerSelectorArgs): Promise<OciLoggingDestination> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (
    !access?.ok ||
    access.credentialType !== 'service_account' ||
    !access.resolvedCredentialId ||
    access.workspaceId !== args.workspaceId
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const client = await createOciClient({
    credentialId: access.resolvedCredentialId,
    workspaceId: args.workspaceId,
    serviceId: OCI_LOGGING_SERVICE_ID,
    region: args.context.region || undefined,
  })
  args.signal?.throwIfAborted()
  const endpoint = await client.prepareStaticEndpoint(OCI_LOGGING_MANAGEMENT_POLICY)
  args.signal?.throwIfAborted()
  args.recordCredentialUse?.(OCI_LOGGING_SERVICE_ID)
  return { client, endpoint }
}

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  destination: OciLoggingDestination
) {
  args.signal?.throwIfAborted()
  const groups = args.selectorKey === 'oci_logging.logGroups'
  const customOnly = args.selectorKey === 'oci_logging.customLogs'
  const scopeId = requireId(groups ? args.context.compartmentId : args.context.logGroupId)
  const selectorRequest = args.request
  const detail = selectorRequest.kind === 'detail'
  try {
    const input = detail
      ? groups
        ? { logGroupId: requireId(selectorRequest.id) }
        : { logGroupId: scopeId, logId: requireId(selectorRequest.id) }
      : groups
        ? { compartmentId: scopeId, limit: 100, page: selectorRequest.cursor }
        : {
            logGroupId: scopeId,
            logType: customOnly ? 'CUSTOM' : undefined,
            limit: 100,
            page: selectorRequest.cursor,
          }
    const result = await executeOciLoggingOperation(
      groups ? (detail ? 'get_log_group' : 'list_log_groups') : detail ? 'get_log' : 'list_logs',
      input,
      destination,
      args.signal
    )
    args.signal?.throwIfAborted()
    const resources: (OciLogGroup | OciLog)[] =
      'logGroups' in result
        ? result.logGroups
        : 'logs' in result
          ? result.logs
          : 'logGroup' in result
            ? [result.logGroup]
            : 'log' in result
              ? [result.log]
              : []
    if (
      resources.some((resource) =>
        groups
          ? resource.compartmentId !== scopeId
          : !('logGroupId' in resource) || resource.logGroupId !== scopeId
      )
    ) {
      throw new SelectorOptionsUnavailableError()
    }
    if (detail && (resources.length !== 1 || resources[0]?.id !== selectorRequest.id.trim())) {
      throw new SelectorOptionsUnavailableError()
    }
    const items = resources
      .filter((resource) => !customOnly || ('logType' in resource && resource.logType === 'CUSTOM'))
      .map((resource) => ({ id: resource.id, label: resource.displayName }))
    if (detail) return detailSelectorResult(items[0] ?? null)
    return listSelectorResult(items, 'nextPage' in result ? result.nextPage : undefined)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) {
      if (detail && error.status === 404) return detailSelectorResult(null)
      if (error.status === 401 || error.status === 403 || error.code === 'credential_unavailable') {
        throw new SelectorConnectionUnavailableError(error.status === 401 ? 401 : 403)
      }
      if (error.status === 429) throw new SelectorOptionsUnavailableError(429)
    }
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = {
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: [OCI_LOGGING_SERVICE_ID] },
  integrationBlockTypes: ['oci_logging'],
  destination: { kind: 'credential-bound', prepare: prepareDestination },
  auditCredentialUse: true,
  execute: executeSelector,
} as const

export const ociLoggingSelectorAttachments = {
  'oci_logging.logGroups': definePreparedSelectorAttachment(attachment),
  'oci_logging.logs': definePreparedSelectorAttachment(attachment),
  'oci_logging.customLogs': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<OciLoggingSelectorKey>
