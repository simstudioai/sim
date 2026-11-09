import 'server-only'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { getSecretSourceContract } from '@/lib/api/contracts/organization-secrets'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { assistantAccountOptions } from '@/lib/credential-groups/member-integrations'
import { listSearchIntegrations } from '@/lib/knowledge/application/search-integrations'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import type { SearchSource } from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'
import { searchSourceCatalog } from '@/platform/lib/integrations/source-catalog.generated'

/** Lists only the source approvals and assistant accounts returned for this organization. */
export async function readSourceSettings(id: string) {
  const { principal } = await requireSessionViewer()
  const input = { organizationId: id }
  const [policies, accounts, { source }] = await Promise.all([
    listSearchIntegrations
      .execute({ principal, input })
      .then((data) => asRouteResponse(listSearchIntegrationsContract, { success: true, data })),
    getOrganizationAccountsSettings
      .execute({ principal, input })
      .then((settings) => asRouteResponse(getOrganizationAccountsContract, settings)),
    readOrganizationSecretSource
      .execute({ principal, input })
      .then((secretSource) => asRouteResponse(getSecretSourceContract, secretSource)),
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
