import { Globe } from 'lucide-react'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Company Domain enrichment. Resolves a company's website domain from its name
 * via a People Data Labs company match.
 */
export const companyDomainEnrichment: EnrichmentConfig = {
  id: 'company-domain',
  name: 'Company Domain',
  description: "Find a company's website domain from its name.",
  icon: Globe,
  inputs: [{ id: 'companyName', name: 'Company name', type: 'string', required: true }],
  outputs: [{ id: 'domain', name: 'domain', type: 'string' }],
  providers: [
    toolProvider({
      id: 'pdl',
      label: 'People Data Labs',
      toolId: 'pdl_company_enrich',
      buildParams: (inputs) => {
        const name = str(inputs.companyName)
        if (!name) return null
        return { name }
      },
      mapOutput: (output) => {
        const company = output.company as Record<string, unknown> | undefined
        const domain = normalizeDomain(company?.website)
        return domain ? { domain } : null
      },
    }),
  ],
}
