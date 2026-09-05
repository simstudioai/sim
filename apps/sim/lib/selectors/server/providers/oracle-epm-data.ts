import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleEpmDestination } from '@/lib/internal/oracle-epm'
import {
  oracleEpmDataConnectionsSchema,
  oracleEpmDataFilesSchema,
  oracleEpmDataPovSchema,
} from '@/lib/internal/oracle-epm-data/contracts'
import { executeOracleEpmDataGetPovStatusOperation } from '@/lib/internal/oracle-epm-data/operations/get-pov-status'
import { executeOracleEpmDataListConnectionsOperation } from '@/lib/internal/oracle-epm-data/operations/list-connections'
import { executeOracleEpmDataListFilesOperation } from '@/lib/internal/oracle-epm-data/operations/list-files'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
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
import type { OracleEpmDataAuthParams } from '@/tools/oracle_epm_data/types'

type OracleEpmDataSelectorKey =
  | 'oracle_epm_data.connections'
  | 'oracle_epm_data.files'
  | 'oracle_epm_data.locations'

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleEpmDataAuthParams> {
  const access = args.credential?.access
  if (!access?.resolvedCredentialId || access.credentialType !== 'service_account')
    throw new SelectorConnectionUnavailableError()
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  )
    throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  let instanceUrl: string
  try {
    instanceUrl = normalizeOracleEpmDestination(token.instanceUrl)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  return {
    oauthCredential: access.resolvedCredentialId,
    accessToken: token.accessToken,
    instanceUrl,
  }
}

async function execute(args: ExecuteServerSelectorArgs, auth: OracleEpmDataAuthParams) {
  args.signal?.throwIfAborted()
  let options: SafeSelectorOption[]
  if (args.selectorKey === 'oracle_epm_data.connections') {
    const result = await executeOracleEpmDataListConnectionsOperation(auth, args.signal)
    if (!result.success) {
      const status = result.output.httpStatus
      throw selectorProviderStatusError(Number.isInteger(status) ? status : 502)
    }
    options = oracleEpmDataConnectionsSchema.shape.response
      .parse(result.output.connections)
      .map((item) => ({ id: item.connectionName, label: item.connectionName }))
  } else if (args.selectorKey === 'oracle_epm_data.files') {
    const result = await executeOracleEpmDataListFilesOperation(auth, args.signal)
    if (!result.success) {
      const status = result.output.httpStatus
      throw selectorProviderStatusError(Number.isInteger(status) ? status : 502)
    }
    options = oracleEpmDataFilesSchema.shape.items.parse(result.output.files).map((item) => ({
      id: item.name,
      label: item.name,
      meta: { type: item.type, size: item.size },
    }))
  } else {
    const { application, period, category } = args.context
    if (!application || !period || !category) throw new SelectorContextUnavailableError()
    const result = await executeOracleEpmDataGetPovStatusOperation(
      { ...auth, application, period, category },
      args.signal
    )
    if (!result.success) {
      const status = result.output.httpStatus
      throw selectorProviderStatusError(Number.isInteger(status) ? status : 502)
    }
    /** Oracle includes application-summary records whose location equals the application name. */
    options = oracleEpmDataPovSchema.shape.response
      .parse(result.output.povs)
      .filter(
        (item) =>
          item.application === application &&
          item.period === period &&
          item.category === category &&
          item.location !== item.application
      )
      .map((item) => ({ id: item.location, label: item.location, meta: { status: item.status } }))
  }
  const unique = new Map(options.map((option) => [option.id, option]))
  return flatSelectorResult(
    args.request,
    [...unique.values()].sort((a, b) => a.label.localeCompare(b.label)),
    true
  )
}

const attachment = {
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle-epm-data'] },
  integrationBlockTypes: ['oracle_epm_data'],
  destination: { kind: 'credential-bound', prepare: prepareDestination },
  execute,
} as const

export const oracleEpmDataSelectorAttachments = {
  'oracle_epm_data.connections': definePreparedSelectorAttachment(attachment),
  'oracle_epm_data.files': definePreparedSelectorAttachment(attachment),
  'oracle_epm_data.locations': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<OracleEpmDataSelectorKey>
