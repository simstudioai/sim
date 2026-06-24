import { filterUndefined } from '@sim/utils/object'
import { Mail } from '@/components/emcn/icons'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Work Email enrichment. Finds a person's work email from a full name plus any
 * available identifiers (company domain, LinkedIn URL) via a provider waterfall:
 * deterministic finders first (Hunter, Findymail by name then by LinkedIn), then
 * enrichment/reveal providers (Prospeo, Wiza), then People Data Labs as a broad
 * record-match fallback, then Datagma, LeadMagic, Dropcontact, Icypeas, and Enrow
 * as additional finders. Each provider opportunistically uses whatever
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
        // `required` makes PDL 404 (free) when the profile has no work email,
        // instead of charging a credit for a match we'd discard as a no-match.
        return filterUndefined({
          name,
          company: normalizeDomain(inputs.companyDomain) || undefined,
          min_likelihood: 6,
          required: 'work_email',
        })
      },
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const email = str(person?.work_email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'datagma',
      label: 'Datagma',
      toolId: 'datagma_find_email',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const company = normalizeDomain(inputs.companyDomain)
        if (!fullName || !company) return null
        return { fullName, company }
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'leadmagic',
      label: 'LeadMagic',
      toolId: 'leadmagic_find_email',
      buildParams: (inputs) => {
        // LeadMagic accepts full_name + domain, so pass the whole name and let it
        // split — this keeps single-token (mononym) rows in play.
        const fullName = str(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!fullName || !domain) return null
        return { full_name: fullName, domain }
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'dropcontact',
      label: 'Dropcontact',
      toolId: 'dropcontact_enrich_contact',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const website = normalizeDomain(inputs.companyDomain)
        const linkedin = str(inputs.linkedinUrl)
        if (!fullName || (!website && !linkedin)) return null
        return filterUndefined({
          full_name: fullName,
          website: website || undefined,
          linkedin: linkedin || undefined,
        })
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'icypeas',
      label: 'Icypeas',
      toolId: 'icypeas_find_email',
      buildParams: (inputs) => {
        // Icypeas only requires domainOrCompany; firstname/lastname are optional,
        // so a mononym still runs with firstname alone rather than self-skipping.
        const fullName = str(inputs.fullName)
        const domainOrCompany = normalizeDomain(inputs.companyDomain)
        if (!fullName || !domainOrCompany) return null
        const name = splitName(inputs.fullName)
        return name
          ? { firstname: name.firstName, lastname: name.lastName, domainOrCompany }
          : { firstname: fullName, domainOrCompany }
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
    }),
    toolProvider({
      id: 'enrow',
      label: 'Enrow',
      toolId: 'enrow_find_email',
      buildParams: (inputs) => {
        const fullname = str(inputs.fullName)
        const company_domain = normalizeDomain(inputs.companyDomain)
        if (!fullname || !company_domain) return null
        return { fullname, company_domain }
      },
      mapOutput: (output) => {
        // Enrow qualifies each found email valid/invalid; only accept verified-valid
        // results so the cell isn't filled with an address Enrow itself rejected
        // (and which hosted billing correctly charges zero for).
        const email = str(output.email)
        const qualification = str(output.qualification).toLowerCase()
        return email && qualification === 'valid' ? { email } : null
      },
    }),
  ],
}
