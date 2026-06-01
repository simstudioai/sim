import { filterUndefined } from '@sim/utils/object'
import { Mail } from '@/components/emcn/icons'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Work Email enrichment. Finds a person's work email from a full name plus any
 * available identifiers (company domain, LinkedIn URL) via a provider waterfall:
 * deterministic finders first (Hunter, Findymail by name then by LinkedIn), then
 * enrichment/reveal providers (Prospeo, Wiza), then People Data Labs as a broad
 * record-match fallback. Each provider opportunistically uses whatever
 * identifiers the row provides and self-skips when it has none usable, so adding
 * more inputs widens coverage. First email wins; all providers support hosted keys.
 */
export const workEmailEnrichment: EnrichmentConfig = {
  id: 'work-email',
  name: 'Work Email',
  description: "Find a person's work email from their name, company, or LinkedIn URL.",
  icon: Mail,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string' },
    { id: 'linkedinUrl', name: 'LinkedIn URL', type: 'string' },
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
      id: 'findymail-linkedin',
      label: 'Findymail (LinkedIn)',
      toolId: 'findymail_find_email_from_linkedin',
      buildParams: (inputs) => {
        const linkedin = str(inputs.linkedinUrl)
        if (!linkedin) return null
        return { linkedin_url: linkedin }
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
        const linkedin = str(inputs.linkedinUrl)
        const fullName = str(inputs.fullName)
        const companyWebsite = normalizeDomain(inputs.companyDomain)
        if (!linkedin && !(fullName && companyWebsite)) return null
        return filterUndefined({
          linkedin_url: linkedin || undefined,
          full_name: fullName || undefined,
          company_website: companyWebsite || undefined,
        })
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
        const linkedin = str(inputs.linkedinUrl)
        const fullName = str(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!linkedin && !(fullName && domain)) return null
        // 'partial' reveals the email only (2 credits); avoids phone charges.
        return filterUndefined({
          profile_url: linkedin || undefined,
          full_name: fullName || undefined,
          domain: domain || undefined,
          enrichment_level: 'partial',
        })
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
