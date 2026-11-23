import { Building } from '@sim/emcn/icons'
import { filterUndefined } from '@sim/utils/object'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

export const companyInfoEnrichment: EnrichmentConfig = {
  id: 'company-info',
  name: 'Company Info',
  description: "Look up a company's size and description from its domain.",
  icon: Building,
  inputs: [{ id: 'domain', name: 'Company domain', type: 'string', required: true }],
  outputs: [
    { id: 'employeeCount', name: 'employee count', type: 'string' },
    { id: 'description', name: 'description', type: 'string' },
  ],
  providers: [
    toolProvider({
      id: 'firecrawl',
      label: 'Firecrawl',
      toolId: 'firecrawl_enrich',
      buildParams: (inputs) => {
        const companyDomain = normalizeDomain(inputs.domain)
        return companyDomain ? { enrichmentType: 'company', companyDomain } : null
      },
      mapOutput: (output) => {
        return filterUndefined({
          employeeCount: str(output.employeeCount) || undefined,
          description: str(output.description) || undefined,
        })
      },
    }),
  ],
}
