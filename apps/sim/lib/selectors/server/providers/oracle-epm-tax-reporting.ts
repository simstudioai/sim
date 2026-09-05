import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleEpmDestination, OracleEpmError } from '@/lib/internal/oracle-epm'
import { createTaxReportingClient } from '@/lib/internal/oracle-epm-tax-reporting/client'
import {
  listTaxApplications,
  listTaxJobDefinitions,
} from '@/lib/internal/oracle-epm-tax-reporting/operations'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
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

type TaxSelectorKey =
  | 'oracle_epm_tax_reporting.applications'
  | 'oracle_epm_tax_reporting.jobDefinitions'
type Destination = { instanceUrl: string; accessToken: string }

async function prepare(args: ExecuteServerSelectorArgs): Promise<Destination> {
  const credential = args.credential
  const access = credential?.access
  if (!credential || access?.credentialType !== 'service_account' || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  const account = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    account?.credentialType !== 'service_account' ||
    account.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const token = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  try {
    return {
      accessToken: token.accessToken,
      instanceUrl: normalizeOracleEpmDestination(token.instanceUrl),
    }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

const jobTypes: Record<string, string> = {
  RULES: 'RULES',
  RULESET: 'RULESET',
  EXPORT_METADATA: 'EXPORT_METADATA',
  IMPORT_METADATA: 'IMPORT_METADATA',
  oracle_epm_tax_reporting_run_rule: 'RULES',
  oracle_epm_tax_reporting_run_ruleset: 'RULESET',
  oracle_epm_tax_reporting_export_metadata: 'EXPORT_METADATA',
  oracle_epm_tax_reporting_import_metadata: 'IMPORT_METADATA',
}

async function execute(args: ExecuteServerSelectorArgs, destination: Destination) {
  args.signal?.throwIfAborted()
  const client = createTaxReportingClient(destination)
  let options: SafeSelectorOption[]
  try {
    if (args.selectorKey === 'oracle_epm_tax_reporting.applications') {
      const result = await listTaxApplications(client, args.signal)
      options = result.items.map((item) => ({ id: item.name, label: item.name }))
    } else {
      // Manifest aliases application to the existing projectId context slot, and the
      // active job type/operation to objectType. Neither is a destination or authority.
      const application = args.context.projectId
      const jobType = jobTypes[args.context.objectType ?? '']
      if (!application || application.length > 255 || !jobType)
        throw new SelectorContextUnavailableError()
      const result = await listTaxJobDefinitions(client, application, jobType, args.signal)
      options = result.items
        .filter((item) => item.jobType.toUpperCase() === jobType)
        .map((item) => ({ id: item.jobName, label: item.jobName, meta: { detail: item.jobType } }))
    }
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof SelectorContextUnavailableError) throw error
    if (error instanceof OracleEpmError) throw selectorProviderStatusError(error.status ?? 502)
    throw new SelectorOptionsUnavailableError()
  }
  const unique = [...new Map(options.map((option) => [option.id, option])).values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  )
  return flatSelectorResult(args.request, unique, true)
}

const attachment = {
  credential: {
    kind: 'stored',
    field: 'oauthCredential',
    serviceIds: ['oracle_epm_tax_reporting'],
  },
  integrationBlockTypes: ['oracle_epm_tax_reporting'],
  destination: { kind: 'credential-bound', prepare },
  execute,
} as const

export const taxReportingSelectorAttachments = {
  'oracle_epm_tax_reporting.applications': definePreparedSelectorAttachment(attachment),
  'oracle_epm_tax_reporting.jobDefinitions': definePreparedSelectorAttachment(attachment),
} satisfies ServerSelectorAttachmentMap<TaxSelectorKey>
