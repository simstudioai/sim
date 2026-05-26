import { Phone } from 'lucide-react'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Phone Number enrichment. v1 is a stub returning no number (the value resolves
 * empty) — wiring a real data provider (with credentials) is a follow-up. The
 * inputs/outputs contract is in place so the pipeline + UI work end to end.
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
  async enrich(inputs) {
    const fullName = String(inputs.fullName ?? '').trim()
    if (!fullName) {
      throw new Error('Full name is required')
    }
    // TODO: call a real phone-lookup provider via ctx; returns empty for now.
    return { phone: '' }
  },
}
