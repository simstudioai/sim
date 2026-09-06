import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleEpmDestination, OracleEpmError } from '@/lib/internal/oracle-epm'
import { listOraclePcmFiles } from '@/lib/internal/oracle-epm-profitability/files.server'
import {
  isOraclePcmDownloadablePath,
  OraclePcmOperationError,
} from '@/lib/internal/oracle-epm-profitability/normalizers'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import type { OraclePcmAuthParams } from '@/tools/oracle_epm_profitability/types'

type OraclePcmSelectorKey = Extract<
  ServerSelectorKey,
  'oracleEpmPcm.inputFiles' | 'oracleEpmPcm.outputFiles'
>
type PreparedOraclePcmDestination = OraclePcmAuthParams & {
  instanceUrl: string
  accessToken: string
}

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedOraclePcmDestination> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (access?.credentialType !== 'service_account' || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  args.signal?.throwIfAborted()
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

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  auth: PreparedOraclePcmDestination
) {
  args.signal?.throwIfAborted()
  let options: SafeSelectorOption[]
  try {
    const inputFiles = args.selectorKey === 'oracleEpmPcm.inputFiles'
    const prefix = inputFiles ? 'profitinbox/' : 'profitoutbox/'
    options = (await listOraclePcmFiles(auth, args.signal))
      .filter((file) => isOraclePcmDownloadablePath(file.name))
      .filter(
        (file) =>
          file.name.startsWith(prefix) &&
          (!inputFiles || !file.name.slice(prefix.length).includes('/'))
      )
      .map((file) => ({
        id: inputFiles ? file.name.slice(prefix.length) : file.name,
        label: file.name.slice(prefix.length),
        meta: { size: file.size },
      }))
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError) throw selectorProviderStatusError(error.status ?? 502)
    if (error instanceof OraclePcmOperationError) throw new SelectorOptionsUnavailableError()
    throw error
  }
  const unique = [...new Map(options.map((option) => [option.id, option])).values()].sort(
    (left, right) => left.label.localeCompare(right.label)
  )
  return flatSelectorResult(args.request, unique, true)
}

const attachment = {
  credential: {
    kind: 'stored',
    field: 'oauthCredential',
    serviceIds: ['oracle-epm-profitability'],
  },
  integrationBlockTypes: ['oracle_epm_profitability'],
  destination: { kind: 'credential-bound', prepare: prepareDestination },
  execute: executeSelector,
} as const

export const oraclePcmSelectorAttachments = {
  'oracleEpmPcm.inputFiles': definePreparedSelectorAttachment(attachment),
  'oracleEpmPcm.outputFiles': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<OraclePcmSelectorKey>
