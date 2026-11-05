import { Mail } from '@sim/emcn/icons'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

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
      id: 'firecrawl',
      label: 'Firecrawl',
      toolId: 'firecrawl_enrich',
      buildParams: (inputs) => {
        const fullName = str(inputs.fullName)
        const companyDomain = normalizeDomain(inputs.companyDomain)
        const linkedinUrl = str(inputs.linkedinUrl)
        if (!linkedinUrl && !(fullName && companyDomain)) return null
        return { enrichmentType: 'work_email', fullName, companyDomain, linkedinUrl }
      },
      mapOutput: (output) => {
        const email = str(output.email)
        return email ? { email } : null
      },
      isVerified: (output) => output.emailVerified === true,
    }),
  ],
}
