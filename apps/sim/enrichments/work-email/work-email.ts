import { Mail } from 'lucide-react'
import type { EnrichmentConfig } from '@/enrichments/types'

/** Normalizes a name part into an email-safe token (lowercase, alphanumeric). */
function token(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
}

/** Strips protocol / path / leading `www.` from a domain-ish input. */
function normalizeDomain(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/**
 * Work Email enrichment. v1 guesses `first.last@domain` from the mapped inputs.
 * Swap `enrich` for a real finder (Hunter/Apollo) later — the inputs/outputs
 * contract stays the same.
 */
export const workEmailEnrichment: EnrichmentConfig = {
  id: 'work-email',
  name: 'Work Email',
  description: "Find a person's work email from their name and company domain.",
  icon: Mail,
  inputs: [
    { id: 'firstName', name: 'First name', type: 'string', required: true },
    { id: 'lastName', name: 'Last name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string', required: true },
  ],
  outputs: [{ id: 'email', name: 'email', type: 'string' }],
  async enrich(inputs) {
    const first = token(inputs.firstName)
    const last = token(inputs.lastName)
    const domain = normalizeDomain(inputs.companyDomain)
    if (!first || !last || !domain) {
      throw new Error('First name, last name, and company domain are required')
    }
    return { email: `${first}.${last}@${domain}` }
  },
}
