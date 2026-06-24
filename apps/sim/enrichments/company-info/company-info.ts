import { filterUndefined } from '@sim/utils/object'
import { Building2 } from 'lucide-react'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Company Info enrichment. Looks up a company by domain, trying Hunter first
 * (free) then People Data Labs, then Datagma and LeadMagic as fallbacks. Outputs
 * are limited to the fields the providers reliably return — employee count and
 * description — so the result stays consistent regardless of which provider fills
 * the cell. `employeeCount` is a string so Hunter's range bucket (e.g. `"11-50"`),
 * PDL's exact count, and LeadMagic's range all map onto the same column.
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
        // `required` makes PDL 404 (free) when neither field we extract is
        // present, instead of charging a credit for a match we'd discard.
        return { website, required: 'employee_count OR summary' }
      },
      mapOutput: (output) => {
        const company = output.company as Record<string, unknown> | undefined
        return filterUndefined({
          employeeCount: str(company?.employee_count) || undefined,
          description: str(company?.summary) || undefined,
        })
      },
    }),
    toolProvider({
      id: 'datagma',
      label: 'Datagma',
      toolId: 'datagma_enrich_company',
      buildParams: (inputs) => {
        const data = normalizeDomain(inputs.domain)
        if (!data) return null
        return { data }
      },
      mapOutput: (output) => {
        return filterUndefined({
          employeeCount: str(output.companySize) || undefined,
          description: str(output.shortDescription) || undefined,
        })
      },
    }),
    toolProvider({
      id: 'leadmagic',
      label: 'LeadMagic',
      toolId: 'leadmagic_company_search',
      buildParams: (inputs) => {
        const companyDomain = normalizeDomain(inputs.domain)
        if (!companyDomain) return null
        return { company_domain: companyDomain }
      },
      mapOutput: (output) => {
        // Prefer the headcount range to match Hunter's bucket style; fall back to the exact count.
        return filterUndefined({
          employeeCount: str(output.employeeRange) || str(output.employeeCount) || undefined,
          description: str(output.description) || undefined,
        })
      },
    }),
  ],
}
