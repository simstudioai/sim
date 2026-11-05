import { Phone } from '@sim/emcn/icons'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

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
      id: 'firecrawl',
      label: 'Firecrawl',
      toolId: 'firecrawl_enrich',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const companyDomain = normalizeDomain(inputs.companyDomain)
        const linkedinUrl = str(inputs.linkedinUrl)
        if (!linkedinUrl && !(fullName && companyDomain)) return null
        return { enrichmentType: 'phone', fullName, companyDomain, linkedinUrl }
      },
      mapOutput: (output) => {
        const phone = str(output.phone)
        return phone ? { phone } : null
      },
    }),
  ],
}
