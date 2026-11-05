import 'server-only'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getSecretSourceContract } from '@/lib/api/contracts/organization-secrets'
import { assistantAccountOptions } from '@/lib/credential-groups/member-integrations'
import type { SearchSource } from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { serverRequestJson } from '@/platform/lib/data/server-request'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'
import { searchSourceCatalog } from '@/platform/lib/integrations/source-catalog.generated'

/** Lists only the source approvals and assistant accounts returned for this organization. */
export async function readSourceSettings(id: string) {
  const [policies, accounts, { source }] = await Promise.all([
    serverRequestJson(listSearchIntegrationsContract, { query: { organizationId: id } }),
    serverRequestJson(getOrganizationAccountsContract, { params: { id } }),
    serverRequestJson(getSecretSourceContract, { params: { id } }),
  ])
  const sources: SearchSource[] = policies.data.flatMap((policy) => {
    if (!policy.approved) return []
    const meta = searchSourceCatalog.find((entry) => entry.id === policy.connectorType)
    if (!meta) return []
    return [
      {
        ...meta,
        approved: true,
        mode: policy.policy?.accessMode ?? (meta.id === 'gitlab' ? 'service_account' : 'member'),
      },
    ]
  })
  const { configured } = assistantAccountOptions(accounts, '')
  const apps = configured.map((option) => ({
    id: option.provider,
    name:
      credentialGroupCatalog.find((item) => item.provider === option.provider)?.name ??
      option.provider,
    account: accounts.viewerAccounts?.find((account) => account.optionId === option.id)
      ?.displayName,
  }))
  return { sources, apps, secret: source }
}
