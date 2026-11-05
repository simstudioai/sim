import { ShieldCheck } from '@sim/emcn/icons'
import { str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

export const emailVerificationEnrichment: EnrichmentConfig = {
  id: 'email-verification',
  name: 'Email Verification',
  description: "Check an email address's deliverability and risk status.",
  icon: ShieldCheck,
  inputs: [{ id: 'email', name: 'Email', type: 'string', required: true }],
  outputs: [
    { id: 'status', name: 'status', type: 'string' },
    { id: 'deliverable', name: 'deliverable', type: 'boolean' },
  ],
  providers: [
    toolProvider({
      id: 'zerobounce',
      label: 'ZeroBounce',
      toolId: 'zerobounce_verify_email',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        if (!email) return null
        return { email }
      },
      mapOutput: (output) => {
        const status = str(output.status)
        if (!status || status === 'unknown') return null
        return { status, deliverable: output.deliverable === true }
      },
    }),
  ],
}
