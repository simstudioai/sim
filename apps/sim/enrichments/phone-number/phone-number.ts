import { filterUndefined } from '@sim/utils/object'
import { Phone } from 'lucide-react'
import { firstNonEmpty, normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Phone Number enrichment. Finds a contact's phone number from their full name
 * and (optionally) company domain via a waterfall: People Data Labs first
 * (cheapest, name-only capable), then Wiza and Prospeo mobile reveals as
 * fallbacks. Wiza/Prospeo need a company domain, so they self-skip without one.
 * The first provider to return a phone wins; all support hosted keys.
 */
export const phoneNumberEnrichment: EnrichmentConfig = {
  id: 'phone-number',
  name: 'Phone Number',
  description: "Find a contact's phone number from their name and company domain.",
  icon: Phone,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string' },
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
        const fullName = str(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!fullName || !domain) return null
        // 'phone' reveals the mobile number (5 credits).
        return { full_name: fullName, domain, enrichment_level: 'phone' }
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
      id: 'prospeo',
      label: 'Prospeo',
      toolId: 'prospeo_enrich_person',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const companyWebsite = normalizeDomain(inputs.companyDomain)
        if (!fullName || !companyWebsite) return null
        return { full_name: fullName, company_website: companyWebsite, enrich_mobile: true }
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
