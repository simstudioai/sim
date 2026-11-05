import { LinkedIn } from '@sim/emcn/icons'
import { normalizeDomain, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

function normalizeLinkedInProfileUrl(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  const [kind, slug] = url.pathname.split('/').filter(Boolean)
  const isLinkedIn = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')
  if (!isLinkedIn || kind?.toLowerCase() !== 'in' || !slug) return null

  return `https://www.linkedin.com/in/${slug}`
}

export const linkedinProfileEnrichment: EnrichmentConfig = {
  id: 'linkedin-profile',
  name: 'LinkedIn Profile',
  description: "Find a person's LinkedIn profile URL from their name, email, and company.",
  icon: LinkedIn,
  inputs: [
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'email', name: 'Email', type: 'string' },
    { id: 'companyName', name: 'Company name', type: 'string' },
    { id: 'companyDomain', name: 'Company domain', type: 'string' },
  ],
  outputs: [{ id: 'linkedinUrl', name: 'linkedin_url', type: 'string' }],
  providers: [
    toolProvider({
      id: 'firecrawl',
      label: 'Firecrawl',
      toolId: 'firecrawl_enrich',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        const fullName = str(inputs.fullName)
        const companyDomain = normalizeDomain(inputs.companyDomain)
        const companyName = str(inputs.companyName)
        if (!email && !(fullName && (companyDomain || companyName))) return null
        return { enrichmentType: 'linkedin', email, fullName, companyDomain, companyName }
      },
      mapOutput: (output) => {
        const linkedinUrl = normalizeLinkedInProfileUrl(output.linkedinUrl)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
  ],
}
