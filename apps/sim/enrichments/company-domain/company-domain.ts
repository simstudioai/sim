import { Globe } from 'lucide-react'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Company Domain enrichment. Resolves a company's website domain from its name
 * via a People Data Labs company match, falling back to Datagma's company enrich.
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
        // `required` makes PDL 404 (free) when the match has no website,
        // instead of charging a credit for a match we'd discard as a no-match.
        return { name, required: 'website' }
      },
      mapOutput: (output) => {
        const company = output.company as Record<string, unknown> | undefined
        const domain = normalizeDomain(company?.website)
        return domain ? { domain } : null
      },
    }),
    toolProvider({
      id: 'datagma',
      label: 'Datagma',
      toolId: 'datagma_enrich_company',
      buildParams: (inputs) => {
        // Datagma's `data` accepts a company name and returns its website.
        const data = str(inputs.companyName)
        if (!data) return null
        return { data }
      },
      mapOutput: (output) => {
        const domain = normalizeDomain(output.website)
        return domain ? { domain } : null
      },
    }),
  ],
}
