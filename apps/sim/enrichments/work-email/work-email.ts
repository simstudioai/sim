import { Mail } from '@sim/emcn/icons'
import { filterUndefined, toArray } from '@sim/utils/object'
import { projectProspeoEnrichmentFailure } from '@/enrichments/provider-failures/prospeo'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/** The address Wiza marked `valid`: the primary one, else the first in `emails`. */
function wizaValidEmail(output: Record<string, unknown>): unknown {
  if (output.email_status === 'valid') return output.email
  const emails = toArray<Record<string, unknown>>(output.emails)
  return emails.find((e) => e.email_status === 'valid')?.email
}

/**
 * Work Email enrichment. Finds a person's work email from a full name plus any
 * available identifiers (company domain, LinkedIn URL) via a provider waterfall:
 * deterministic finders first (Hunter, Findymail by name then by LinkedIn), then
 * enrichment/reveal providers (Prospeo, Wiza), then Datagma, LeadMagic,
 * Dropcontact, and Enrow as additional finders, and People Data Labs last — an
 * unverified database record at the highest price per hit. Each provider
 * opportunistically uses whatever identifiers the row provides and self-skips
 * when it has none usable, so adding more inputs widens coverage. The first
 * mailbox-verified email wins; an unverified one (e.g. a catch-all guess) is kept
 * only if nothing verified turns up. All providers support hosted keys.
 */
export const workEmailEnrichment: EnrichmentConfig = {
  id: 'work-email',
  name: 'Work Email',
  description: "Find a person's work email from their name, company, or LinkedIn URL.",
  icon: Mail,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string', required: true },
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
      // Only a mailbox-verified hit is final; accept_all/unknown guesses are held.
      isVerified: (output) =>
        (output.verification as Record<string, unknown> | null)?.status === 'valid',
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
          // An unverified email becomes a free NO_MATCH instead of a billed hit.
          only_verified_email: true,
        })
      },
      projectFailure: projectProspeoEnrichmentFailure,
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
          accept_work: true,
          accept_personal: false,
        })
      },
      // Wiza bills only when a `valid` email comes back, so take that one; a
      // `risky`-only result is free and held as a fallback.
      mapOutput: (output) => {
        const email = str(wizaValidEmail(output)) || str(output.email)
        return email ? { email } : null
      },
      isVerified: (output) => str(wizaValidEmail(output)) !== '',
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
      isVerified: (output) => output.status === 'valid',
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
      // The live API labels a verified work address `nominatif@pro`; its docs say `nominative@pro`.
      isVerified: (output) =>
        output.qualification === 'nominatif@pro' || output.qualification === 'nominative@pro',
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
      // Database record, never mailbox-checked; runs only while nothing is held.
      isVerified: false,
    }),
  ],
}
