import { filterUndefined } from '@sim/utils/object'
import { Building2 } from 'lucide-react'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Company Info enrichment. Looks up a company by domain, trying Hunter first
 * (free) then People Data Labs as a fallback. Outputs are limited to the fields
 * both providers reliably return — employee count and description — so the
 * result stays consistent regardless of which provider fills the cell.
 * `employeeCount` is a string so Hunter's range bucket (e.g. `"11-50"`) and
 * PDL's exact count map onto the same column.
 */
export const companyInfoEnrichment: EnrichmentConfig = {
  id: 'company-info',
  name: 'Company Info',
  description: "Look up a company's size and description from its domain.",
  icon: Building2,
  inputs: [{ id: 'domain', name: 'Company domain', type: 'string', required: true }],
  outputs: [
    { id: 'employeeCount', name: 'employee count', type: 'string' },
    { id: 'description', name: 'description', type: 'string' },
  ],
  providers: [
    toolProvider({
      id: 'hunter',
      label: 'Hunter',
      toolId: 'hunter_companies_find',
      buildParams: (inputs) => {
        const domain = normalizeDomain(inputs.domain)
        if (!domain) return null
        return { domain }
      },
      mapOutput: (output) => {
        return filterUndefined({
          employeeCount: str(output.size) || undefined,
          description: str(output.description) || undefined,
        })
      },
    }),
    toolProvider({
      id: 'pdl',
      label: 'People Data Labs',
      toolId: 'pdl_company_enrich',
      buildParams: (inputs) => {
        const website = normalizeDomain(inputs.domain)
        if (!website) return null
        return { website }
      },
      mapOutput: (output) => {
        const company = output.company as Record<string, unknown> | undefined
        return filterUndefined({
          employeeCount: str(company?.employee_count) || undefined,
          description: str(company?.summary) || undefined,
        })
      },
    }),
  ],
}
