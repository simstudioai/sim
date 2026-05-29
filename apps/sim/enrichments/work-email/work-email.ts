import { filterUndefined } from '@sim/utils/object'
import { Mail } from 'lucide-react'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Work Email enrichment. Finds a person's work email from their full name and
 * company domain via a provider waterfall: deterministic finders first (Hunter,
 * Findymail), then enrichment/reveal providers (Prospeo, Wiza), then People Data
 * Labs as a broad record-match fallback. The first provider to return an email
 * wins; each provider supports hosted keys so the cascade runs without BYOK.
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
      id: 'findymail',
      label: 'Findymail',
      toolId: 'findymail_find_email_from_name',
      buildParams: (inputs) => {
        const name = str(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!name || !domain) return null
        return { name, domain }
      },
      mapOutput: (output) => {
        const contact = output.contact as Record<string, unknown> | null
        const email = str(contact?.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'prospeo',
      label: 'Prospeo',
      toolId: 'prospeo_enrich_person',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const companyWebsite = normalizeDomain(inputs.companyDomain)
        if (!fullName || !companyWebsite) return null
        return { full_name: fullName, company_website: companyWebsite }
      },
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const emailObj = person?.email as Record<string, unknown> | undefined
        const email = str(emailObj?.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'wiza',
      label: 'Wiza',
      toolId: 'wiza_individual_reveal',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!fullName || !domain) return null
        // 'partial' reveals the email only (2 credits); avoids phone charges.
        return { full_name: fullName, domain, enrichment_level: 'partial' }
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
