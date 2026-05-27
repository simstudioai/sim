import { filterUndefined } from '@sim/utils/object'
import { Mail } from 'lucide-react'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Work Email enrichment. Finds a person's work email from their full name and
 * company domain, trying Hunter first (deterministic finder) then People Data
 * Labs (record match) as a fallback.
 */
export const workEmailEnrichment: EnrichmentConfig = {
  id: 'work-email',
  name: 'Work Email',
  description: "Find a person's work email from their name and company domain.",
  icon: Mail,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string', required: true },
  ],
  outputs: [{ id: 'email', name: 'email', type: 'string' }],
  providers: [
    toolProvider({
      id: 'hunter',
      label: 'Hunter',
      toolId: 'hunter_email_finder',
      buildParams: (inputs) => {
        const name = splitName(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!name || !domain) return null
        return { domain, first_name: name.firstName, last_name: name.lastName }
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'pdl',
      label: 'People Data Labs',
      toolId: 'pdl_person_enrich',
      buildParams: (inputs) => {
        const name = str(inputs.fullName)
        if (!name) return null
        return filterUndefined({
          name,
          company: normalizeDomain(inputs.companyDomain) || undefined,
          min_likelihood: 6,
        })
      },
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const email = str(person?.work_email)
        return email ? { email } : null
      },
    }),
  ],
}
