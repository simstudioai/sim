import { filterUndefined } from '@sim/utils/object'
import { Phone } from 'lucide-react'
import { firstNonEmpty, normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Phone Number enrichment. Finds a contact's phone number from a full name plus
 * any available identifiers (company domain, LinkedIn URL) via a waterfall:
 * People Data Labs (name match) → Wiza reveal → Findymail (LinkedIn) → Prospeo
 * mobile. Each provider opportunistically uses whatever identifiers the row
 * provides and self-skips when it has none usable, so adding more inputs widens
 * coverage without reordering. First phone wins; all providers support hosted keys.
 */
export const phoneNumberEnrichment: EnrichmentConfig = {
  id: 'phone-number',
  name: 'Phone Number',
  description: "Find a contact's phone number from their name, company, or LinkedIn URL.",
  icon: Phone,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string' },
    { id: 'linkedinUrl', name: 'LinkedIn URL', type: 'string' },
  ],
  outputs: [{ id: 'phone', name: 'phone', type: 'string' }],
  providers: [
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
        const phone = firstNonEmpty(person?.phone_numbers) ?? str(person?.mobile_phone)
        return phone ? { phone } : null
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
        // Needs a LinkedIn URL or a name+domain pair; skip otherwise.
        if (!linkedin && !(fullName && domain)) return null
        // 'phone' reveals the mobile number (5 credits). Prefer LinkedIn when present.
        return filterUndefined({
          profile_url: linkedin || undefined,
          full_name: fullName || undefined,
          domain: domain || undefined,
          enrichment_level: 'phone',
        })
      },
      mapOutput: (output) => {
        const phones = Array.isArray(output.phones)
          ? (output.phones as Record<string, unknown>[])
          : []
        const phone = str(output.mobile_phone) || str(output.phone_number) || str(phones[0]?.number)
        return phone ? { phone } : null
      },
    }),
    toolProvider({
      id: 'findymail',
      label: 'Findymail',
      toolId: 'findymail_find_phone',
      buildParams: (inputs) => {
        // Findymail's phone finder keys off a LinkedIn URL only.
        const linkedin = str(inputs.linkedinUrl)
        if (!linkedin) return null
        return { linkedin_url: linkedin }
      },
      mapOutput: (output) => {
        const phone = str(output.phone)
        return phone ? { phone } : null
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
          enrich_mobile: true,
        })
      },
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const mobile = person?.mobile as Record<string, unknown> | undefined
        const phone = str(mobile?.mobile)
        return phone ? { phone } : null
      },
    }),
  ],
}
