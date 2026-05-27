import { filterUndefined } from '@sim/utils/object'
import { Building2 } from 'lucide-react'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/** Returns the value when it's a finite number, else `undefined`. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Company Info enrichment. Looks up firmographics for a company domain, trying
 * People Data Labs first (richest record, incl. employee count) then Hunter as
 * a fallback.
 */
export const companyInfoEnrichment: EnrichmentConfig = {
  id: 'company-info',
  name: 'Company Info',
  description:
    "Look up a company's industry, size, founding year, and description from its domain.",
  icon: Building2,
  inputs: [{ id: 'domain', name: 'Company domain', type: 'string', required: true }],
  outputs: [
    { id: 'industry', name: 'industry', type: 'string' },
    { id: 'employeeCount', name: 'employee count', type: 'number' },
    { id: 'foundedYear', name: 'founded year', type: 'number' },
    { id: 'description', name: 'description', type: 'string' },
  ],
  providers: [
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
          industry: str(company?.industry) || undefined,
          employeeCount: num(company?.employee_count),
          foundedYear: num(company?.founded),
          description: str(company?.summary) || undefined,
        })
      },
    }),
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
          industry: str(output.industry) || undefined,
          foundedYear: num(output.founded_year),
          description: str(output.description) || undefined,
        })
      },
    }),
  ],
}
