import { LinkedIn } from '@sim/emcn/icons'
import { filterUndefined } from '@sim/utils/object'
import { projectProspeoEnrichmentFailure } from '@/enrichments/provider-failures/prospeo'
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

/**
 * LinkedIn Profile enrichment. Resolves a person's LinkedIn URL from a full
 * name plus any available email or company identifiers. Email-specific reverse
 * lookups run first, followed by broader person enrichment providers. Every
 * provider supports hosted keys, and only canonical person-profile URLs are
 * accepted as matches.
 */
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
      id: 'findymail',
      label: 'Findymail',
      toolId: 'findymail_reverse_email_lookup',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        return email ? { email } : null
      },
      mapOutput: (output) => {
        const linkedinUrl = normalizeLinkedInProfileUrl(output.linkedin_url)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
    toolProvider({
      id: 'datagma',
      label: 'Datagma',
      toolId: 'datagma_enrich_person',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        if (email) return { data: email, personFull: false, phoneFull: false }

        const fullName = str(inputs.fullName)
        const companyKeyword = str(inputs.companyName) || normalizeDomain(inputs.companyDomain)
        if (!fullName || !companyKeyword) return null
        return { data: fullName, companyKeyword, personFull: false, phoneFull: false }
      },
      mapOutput: (output) => {
        const linkedinUrl = normalizeLinkedInProfileUrl(output.linkedInUrl)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
    toolProvider({
      id: 'prospeo',
      label: 'Prospeo',
      toolId: 'prospeo_enrich_person',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        const fullName = str(inputs.fullName)
        const companyName = str(inputs.companyName)
        const companyWebsite = normalizeDomain(inputs.companyDomain)
        if (!email && !(fullName && (companyName || companyWebsite))) return null
        return filterUndefined({
          email: email || undefined,
          full_name: fullName || undefined,
          company_name: companyName || undefined,
          company_website: companyWebsite || undefined,
        })
      },
      projectFailure: projectProspeoEnrichmentFailure,
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const linkedinUrl = normalizeLinkedInProfileUrl(person?.linkedin_url)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
    toolProvider({
      id: 'leadmagic',
      label: 'LeadMagic',
      toolId: 'leadmagic_email_to_profile',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        return email ? { work_email: email } : null
      },
      mapOutput: (output) => {
        const linkedinUrl = normalizeLinkedInProfileUrl(output.profile_url)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
    toolProvider({
      id: 'pdl',
      label: 'People Data Labs',
      toolId: 'pdl_person_enrich',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        const fullName = str(inputs.fullName)
        const company = normalizeDomain(inputs.companyDomain) || str(inputs.companyName)
        if (!email && !(fullName && company)) return null
        return filterUndefined({
          email: email || undefined,
          name: fullName || undefined,
          company: company || undefined,
          min_likelihood: 6,
          required: 'linkedin_url',
        })
      },
      mapOutput: (output) => {
        const person = output.person as Record<string, unknown> | undefined
        const linkedinUrl = normalizeLinkedInProfileUrl(person?.linkedin_url)
        return linkedinUrl ? { linkedinUrl } : null
      },
    }),
  ],
}
