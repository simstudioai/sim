import { createOciClient, type OciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { ociEventsInputSchemas } from '@/lib/internal/oci-events/input'
import {
  executeOciEventsOperation,
  type OciEventRuleSummary,
} from '@/lib/internal/oci-events/operations'
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

function selectorError(error: unknown): Error {
  if (
    error instanceof OciClientError &&
    (error.code === 'credential_unavailable' || error.status === 401 || error.status === 403)
  ) {
    return new SelectorConnectionUnavailableError(error.status === 401 ? 401 : 403)
  }
  return new SelectorOptionsUnavailableError(
    error instanceof OciClientError && error.status === 429 ? 429 : 502
  )
}

async function prepareDestination(args: ExecuteServerSelectorArgs): Promise<OciClient> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (!access?.ok || !access.resolvedCredentialId || access.credentialType !== 'service_account') {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    return await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      serviceId: 'oci_events',
      region: args.context.region,
    })
  } catch (error) {
    args.signal?.throwIfAborted()
    throw selectorError(error)
  }
}

function option(rule: OciEventRuleSummary) {
  return {
    id: rule.id,
    label: rule.displayName || rule.id,
    meta: { lifecycleState: rule.lifecycleState, isEnabled: rule.isEnabled },
  }
}

async function executeSelector(args: ExecuteServerSelectorArgs, client: OciClient) {
  args.signal?.throwIfAborted()
  const compartmentId = args.context.compartmentId?.trim()
  if (!compartmentId) throw new SelectorContextUnavailableError()
  const operation = args.request.kind === 'detail' ? 'get_rule' : 'list_rules'
  const parsed = ociEventsInputSchemas[operation].safeParse({
    oauthCredential: args.credential?.access?.resolvedCredentialId,
    compartmentId,
    limit: 50,
    ...(args.request.kind === 'detail'
      ? { ruleId: args.request.id }
      : { page: args.request.cursor }),
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const result = await executeOciEventsOperation(client, operation, parsed.data, args.signal)
    if (!result.success) throw new SelectorOptionsUnavailableError()
    if (args.request.kind === 'detail') {
      const rule = result.output.rule
      if (!rule) throw new SelectorOptionsUnavailableError()
      return detailSelectorResult(rule.compartmentId === compartmentId ? option(rule) : null)
    }
    if (!result.output.rules) throw new SelectorOptionsUnavailableError()
    return listSelectorResult(result.output.rules.map(option), result.output.nextPage ?? undefined)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (args.request.kind === 'detail' && error instanceof OciClientError && error.status === 404) {
      return detailSelectorResult(null)
    }
    throw selectorError(error)
  }
}

export const ociEventsSelectorAttachments = {
  'oci_events.rules': definePreparedSelectorAttachment({
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci_events'] },
    integrationBlockTypes: ['oci_events'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
} satisfies ServerSelectorAttachmentMap<'oci_events.rules'>
