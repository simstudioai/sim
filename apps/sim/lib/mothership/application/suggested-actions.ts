import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import { stripVersionSuffix } from '@sim/utils/string'
import type { SuggestedActionCatalog } from '@/lib/api/contracts/suggested-actions'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application'
import { resolveOAuthServiceForIntegration } from '@/lib/integrations/oauth-service'
import { getAllBlockMeta } from '@/blocks/registry'

// permission-group-exempt: the block template catalog is public product copy; it reveals no credentials or workspace resources.
const readSuggestedActionCatalogOperation = defineOperation({
  id: 'mothership.suggested_actions.read',
  capability: 'none',
  principalKinds: ['session'],
})

/** Generic table starters, for a viewer without integration context. */
const TABLE_STARTERS = [
  { label: 'Create a CRM with sample data', prompt: 'Create a CRM with sample data.' },
  { label: 'Build a project tracker', prompt: 'Build a project tracker table.' },
  { label: 'Create a content calendar', prompt: 'Create a content calendar table.' },
  { label: 'Build an expense tracker', prompt: 'Build an expense tracker table.' },
  { label: 'Create a bug tracker', prompt: 'Create a bug tracker table.' },
]

let catalog: SuggestedActionCatalog | undefined

/**
 * Legacy's suggestion pool, built once from the curated block template catalog plus the table
 * starters. Catalog types may carry version suffixes (`gmail_v2`) while block meta keys are base
 * types, so the integration lookup is keyed by both.
 */
function buildCatalog(): SuggestedActionCatalog {
  const integrationByType = new Map(
    INTEGRATION_METADATA.flatMap((integration) => [
      [integration.type, integration] as const,
      [stripVersionSuffix(integration.type), integration] as const,
    ])
  )
  const candidates: SuggestedActionCatalog['candidates'] = TABLE_STARTERS.map(
    ({ label, prompt }, index) => ({
      id: `table-starter-${index}`,
      blockType: `table-starter-${index}`,
      label,
      prompt,
      modules: ['tables'],
      featured: false,
      popular: true,
      providerId: null,
      starter: true,
    })
  )
  const templateCounts: Record<string, number> = {}
  for (const [blockType, meta] of Object.entries(getAllBlockMeta())) {
    const integration = integrationByType.get(blockType)
    if (!integration) continue
    const providerId = resolveOAuthServiceForIntegration(integration)?.providerId ?? null
    for (const [index, template] of (meta.templates ?? []).entries()) {
      candidates.push({
        id: `${blockType}-${index}`,
        blockType,
        label: template.title,
        prompt: template.prompt,
        modules: [...template.modules],
        featured: template.featured ?? false,
        popular: template.category === 'popular',
        providerId,
        starter: false,
      })
      if (providerId) templateCounts[providerId] = (templateCounts[providerId] ?? 0) + 1
    }
  }
  return { candidates, templateCounts }
}

/** Serves the block template catalog that Home's suggested actions sample from. */
export const readSuggestedActionCatalog: OperationUseCase<
  typeof readSuggestedActionCatalogOperation,
  undefined,
  SuggestedActionCatalog
> = {
  operation: readSuggestedActionCatalogOperation,
  async execute({ principal }) {
    assertOperationPrincipal(principal, readSuggestedActionCatalogOperation)
    catalog ??= buildCatalog()
    return catalog
  },
}
