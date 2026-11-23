import { Globe } from '@sim/emcn/icons'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

export const companyDomainEnrichment: EnrichmentConfig = {
  id: 'company-domain',
  name: 'Company Domain',
  description: "Find a company's website domain from its name.",
  icon: Globe,
  inputs: [{ id: 'companyName', name: 'Company name', type: 'string', required: true }],
  outputs: [{ id: 'domain', name: 'domain', type: 'string' }],
  providers: [
    toolProvider({
      id: 'firecrawl',
      label: 'Firecrawl',
      toolId: 'firecrawl_enrich',
      buildParams: (inputs) => {
        const companyName = str(inputs.companyName)
        return companyName ? { enrichmentType: 'company_domain', companyName } : null
      },
      mapOutput: (output) => {
        const domain = normalizeDomain(output.domain)
        return domain ? { domain } : null
      },
    }),
  ],
}
