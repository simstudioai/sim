import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleEpmDestination, OracleEpmError } from '@/lib/internal/oracle-epm'
import { listOracleEpcmFiles } from '@/lib/internal/oracle-epm-enterprise-profitability/files.server'
import {
  EPCM_EXCHANGE_JOB_TYPES,
  OracleEpcmOperationError,
} from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import {
  listOracleEpcmApplications,
  listOracleEpcmJobDefinitions,
} from '@/lib/internal/oracle-epm-enterprise-profitability/operations'
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
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import type {
  OracleEpcmAuthParams,
  OracleEpcmExchangeJobType,
} from '@/tools/oracle_epm_enterprise_profitability/types'

type OracleEpcmSelectorKey = Extract<
  ServerSelectorKey,
  'oracleEpm.applications' | 'oracleEpm.jobDefinitions' | 'oracleEpm.repositoryFiles'
>
type PreparedOracleEpcmDestination = OracleEpcmAuthParams & {
  instanceUrl: string
  accessToken: string
}

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedOracleEpcmDestination> {
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

/** The active operation aliases the filter for a saved-job picker without a second UI choice. */
export function resolveOracleEpcmSelectorJobType(
  value: string | undefined
): OracleEpcmExchangeJobType {
  const candidate = value?.startsWith('oracle_epm_enterprise_profitability_')
    ? value.slice('oracle_epm_enterprise_profitability_'.length).toUpperCase()
    : value
  const jobType = EPCM_EXCHANGE_JOB_TYPES.find((type) => type === candidate)
  if (!jobType) throw new SelectorContextUnavailableError()
  return jobType
}

async function executeSelector(
  args: ExecuteServerSelectorArgs,
  auth: PreparedOracleEpcmDestination
) {
  args.signal?.throwIfAborted()
  let options: SafeSelectorOption[]
  try {
    switch (args.selectorKey) {
      case 'oracleEpm.applications':
        options = (await listOracleEpcmApplications(auth, args.signal)).map((app) => ({
          id: app.name,
          label: app.name,
        }))
        break
      case 'oracleEpm.repositoryFiles':
        options = (await listOracleEpcmFiles(auth, args.signal)).map((file) => ({
          id: file.name,
          label: file.name,
          meta: { size: file.size },
        }))
        break
      case 'oracleEpm.jobDefinitions': {
        const applicationName = args.context.applicationName
        if (!applicationName) throw new SelectorContextUnavailableError()
        const jobType = resolveOracleEpcmSelectorJobType(args.context.jobType)
        options = (
          await listOracleEpcmJobDefinitions({ ...auth, applicationName, jobType }, args.signal)
        ).map((job) => ({ id: job.jobName, label: job.jobName, meta: { jobType: job.jobType } }))
        break
      }
      default:
        throw new SelectorOptionsUnavailableError()
    }
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError) throw selectorProviderStatusError(error.status ?? 502)
    if (error instanceof OracleEpcmOperationError) throw new SelectorOptionsUnavailableError()
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
    serviceIds: ['oracle-epm-enterprise-profitability'],
  },
  integrationBlockTypes: ['oracle_epm_enterprise_profitability'],
  destination: { kind: 'credential-bound', prepare: prepareDestination },
  execute: executeSelector,
} as const

export const oracleEpcmSelectorAttachments = {
  'oracleEpm.applications': definePreparedSelectorAttachment(attachment),
  'oracleEpm.jobDefinitions': definePreparedSelectorAttachment(attachment),
  'oracleEpm.repositoryFiles': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<OracleEpcmSelectorKey>
