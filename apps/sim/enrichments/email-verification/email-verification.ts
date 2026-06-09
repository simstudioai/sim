import { ShieldCheck } from '@/components/emcn/icons'
import { str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Email Verification enrichment. Checks an email address's deliverability via a
 * verifier waterfall — ZeroBounce first (highest coverage), then NeverBounce,
 * then MillionVerifier. A provider that returns a definitive verdict
 * (valid / invalid / catch_all / disposable / etc.) fills the cell; a provider
 * that can only return `unknown` falls through to the next so the row gets the
 * most confident answer available. All providers support hosted keys.
 */
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
        // Fall through to the next verifier when the verdict is missing or inconclusive.
        if (!status || status === 'unknown') return null
        return { status, deliverable: output.deliverable === true }
      },
    }),
    toolProvider({
      id: 'neverbounce',
      label: 'NeverBounce',
      toolId: 'neverbounce_verify_email',
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
    toolProvider({
      id: 'millionverifier',
      label: 'MillionVerifier',
      toolId: 'millionverifier_verify_email',
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
