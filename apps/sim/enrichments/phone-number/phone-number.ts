import { filterUndefined } from '@sim/utils/object'
import { Phone } from 'lucide-react'
import { firstNonEmpty, normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Phone Number enrichment. Finds a contact's phone number from their full name
 * and (optionally) company domain via a People Data Labs person match.
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
  ],
}
