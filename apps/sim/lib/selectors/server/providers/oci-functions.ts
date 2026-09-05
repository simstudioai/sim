import { isPlainRecord } from '@sim/utils/object'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  ociFunctionsResourcePath,
  type PreparedOciFunctionsClient,
  prepareOciFunctionsClient,
  projectOciFunctionsResource,
  requestOciFunctionsManagement,
} from '@/lib/internal/oci-functions/client'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type OciFunctionsSelectorKey = 'oci-functions.applications' | 'oci-functions.functions'

function requiredId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 255 ||
    value === '.' ||
    value === '..'
  ) {
    throw new SelectorContextUnavailableError()
  }
  return value.trim()
}

async function prepareDestination(args: ExecuteServerSelectorArgs) {
  const access = args.credential?.access
  if (
    !access?.ok ||
    !access.resolvedCredentialId ||
    access.credentialType !== 'service_account' ||
    access.workspaceId !== args.workspaceId ||
    args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  args.signal?.throwIfAborted()
  try {
    return await prepareOciFunctionsClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      region: args.context.ociRegion === 'credential' ? undefined : args.context.ociRegion,
    })
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError && error.code === 'credential_unavailable')
      throw new SelectorConnectionUnavailableError()
    throw new SelectorOptionsUnavailableError()
  }
}

function option(value: unknown): SafeSelectorOption {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || !value.id)
    throw new SelectorOptionsUnavailableError()
  return {
    id: value.id,
    label:
      typeof value.displayName === 'string' && value.displayName ? value.displayName : value.id,
    meta: {
      lifecycleState: typeof value.lifecycleState === 'string' ? value.lifecycleState : null,
    },
  }
}

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  prepared: PreparedOciFunctionsClient
) {
  const applications = args.selectorKey === 'oci-functions.applications'
  const kind = applications ? 'applications' : 'functions'
  const scopeKey = applications ? 'compartmentId' : 'applicationId'
  const scopeId = requiredId(args.context[scopeKey])
  try {
    if (args.request.kind === 'detail') {
      const response = await requestOciFunctionsManagement(
        prepared,
        { method: 'GET', path: ociFunctionsResourcePath(kind, requiredId(args.request.id)) },
        args.signal
      )
      const resource = projectOciFunctionsResource(response, kind)
      if (!isPlainRecord(resource)) return detailSelectorResult(null)
      const record: Record<string, unknown> = resource
      if (record[scopeKey] !== scopeId) return detailSelectorResult(null)
      return detailSelectorResult(option(record))
    }
    const query: [string, string][] = [
      [scopeKey, scopeId],
      ['limit', '50'],
    ]
    if (args.request.cursor) {
      if (args.request.cursor.length > 1024) throw new SelectorContextUnavailableError()
      query.push(['page', args.request.cursor])
    }
    const response = await requestOciFunctionsManagement(
      prepared,
      { method: 'GET', path: ociFunctionsResourcePath(kind), query },
      args.signal
    )
    const resources = projectOciFunctionsResource(response, kind, true)
    if (!Array.isArray(resources)) throw new SelectorOptionsUnavailableError()
    return listSelectorResult(resources.map(option), response.headers['opc-next-page'])
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OciClientError) {
      if (args.request.kind === 'detail' && error.status === 404) return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status ?? 502)
    }
    if (error instanceof SelectorContextUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = () =>
  definePreparedSelectorAttachment({
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci-functions'] },
    integrationBlockTypes: ['oci_functions'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  })

export const ociFunctionsSelectorAttachments = {
  'oci-functions.applications': attachment(),
  'oci-functions.functions': attachment(),
} satisfies ServerSelectorAttachmentMap<OciFunctionsSelectorKey>
