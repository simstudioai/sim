import { z } from 'zod'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import {
  settingsOperation,
  settingsOrganizationId,
} from '@/lib/mothership/tools/server/settings-operation'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  addOrganizationDomain,
  listOrganizationDomains,
  projectOrganizationDomainForTool,
  removeOrganizationDomain,
  verifyOrganizationDomain,
} from '@/lib/organizations/application/domain-settings'
import { addOrganizationDomainBodySchema } from '@/lib/organizations/domain-validation'

export async function readSettingsDomains(context: SettingsContext) {
  const result = await listOrganizationDomains.execute({
    principal: context.principal,
    input: { organizationId: settingsOrganizationId(context) },
  })
  return { ...result, domains: result.domains.map(projectOrganizationDomainForTool) }
}

const domainInput = z.strictObject({ domainId: z.string().min(1).max(200) })
export const organizationDomainSettingsActions = {
  add_domain: settingsOperation(
    addOrganizationDomainBodySchema.strict(),
    async (context, input) => {
      const organizationId = settingsOrganizationId(context)
      const result = await addOrganizationDomain.execute({
        principal: context.principal,
        input: { ...input, organizationId },
      })
      return {
        domain: projectOrganizationDomainForTool(result.domain),
        created: result.created,
        ...(result.domain.status === 'pending'
          ? {
              status: 'requires_user_setup',
              setupUrl: organizationRoutes(organizationId).settingsSection('sso'),
              instructions:
                'Add the DNS verification record shown in Settings, then use verify_domain to check it.',
            }
          : {}),
      }
    }
  ),
  verify_domain: settingsOperation(domainInput, async (context, input) => {
    const result = await verifyOrganizationDomain.execute({
      principal: context.principal,
      input: { ...input, organizationId: settingsOrganizationId(context) },
    })
    return { ...result, domain: projectOrganizationDomainForTool(result.domain) }
  }),
  remove_domain: settingsOperation(domainInput, (context, input) =>
    removeOrganizationDomain.execute({
      principal: context.principal,
      input: { ...input, organizationId: settingsOrganizationId(context) },
    })
  ),
}
