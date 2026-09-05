import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { createOracleEpmClient, normalizeOracleEpmDestination } from '@/lib/internal/oracle-epm'
import { listArcsFiles } from '@/lib/internal/oracle-epm-account-reconciliation/operations/list-files'
import { listArcsPeriods } from '@/lib/internal/oracle-epm-account-reconciliation/operations/list-periods'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type ArcsSelectorKey = Extract<
  ServerSelectorKey,
  'oracleEpmAccountReconciliation.periods' | 'oracleEpmAccountReconciliation.files'
>

/** The stored service account, not browser context, supplies the EPM destination. */
async function prepareDestination(args: ExecuteServerSelectorArgs) {
  const access = args.credential?.access
  if (
    !args.credential ||
    access?.credentialType !== 'service_account' ||
    !access.resolvedCredentialId
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const token = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  try {
    return createOracleEpmClient({
      accessToken: token.accessToken,
      instanceUrl: normalizeOracleEpmDestination(token.instanceUrl),
    })
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  client: Awaited<ReturnType<typeof prepareDestination>>
) {
  let options: SafeSelectorOption[]
  if (args.selectorKey === 'oracleEpmAccountReconciliation.periods') {
    const result = await listArcsPeriods(client, 'ALL', args.signal)
    options = result.items.map((period) => ({
      id: period.Name,
      label: period.Name,
      meta: { periodId: period.Id, status: period.Status },
    }))
  } else {
    const result = await listArcsFiles(client, args.signal)
    options = result.items.map((file) => ({
      id: file.name,
      label: file.name,
      meta: { type: file.type, size: file.size, lastmodifiedtime: file.lastmodifiedtime },
    }))
  }
  if (args.request.kind === 'list' && args.request.search) {
    const search = args.request.search.toLocaleLowerCase()
    options = options.filter((option) => option.label.toLocaleLowerCase().includes(search))
  }
  return flatSelectorResult(args.request, options, true)
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle-epm-account-reconciliation'],
} as const
const integrationBlockTypes = ['oracle_epm_account_reconciliation'] as const

export const oracleEpmAccountReconciliationSelectorAttachments = {
  'oracleEpmAccountReconciliation.periods': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
  'oracleEpmAccountReconciliation.files': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
} satisfies ServerSelectorAttachmentMap<ArcsSelectorKey>
