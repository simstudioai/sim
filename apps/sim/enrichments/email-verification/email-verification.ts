import { ShieldCheck } from '@sim/emcn/icons'
import { str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

/**
 * Verdicts that say nothing about the mailbox; the cascade falls through to the
 * next verifier on these. MillionVerifier reports `unverified` (and may report
 * `error`) when it could not complete a check.
 */
const INCONCLUSIVE_STATUSES = new Set(['unknown', 'unverified', 'error'])

function mapVerdict(output: Record<string, unknown>) {
  const status = str(output.status)
  if (!status || INCONCLUSIVE_STATUSES.has(status)) return null
  return { status, deliverable: output.deliverable === true }
}

/**
 * Email Verification enrichment. Checks an email address's deliverability via a
 * verifier waterfall — ZeroBounce first (highest coverage), then NeverBounce,
 * then MillionVerifier, then Enrow. A provider that returns a definitive verdict
 * (valid / invalid / catch_all / disposable / etc.) fills the cell; an
 * inconclusive one falls through to the next so the row gets the most confident
 * answer available. All providers support hosted keys.
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
      mapOutput: mapVerdict,
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
      mapOutput: mapVerdict,
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
      mapOutput: mapVerdict,
    }),
    toolProvider({
      id: 'enrow',
      label: 'Enrow',
      toolId: 'enrow_verify_email',
      buildParams: (inputs) => {
        const email = str(inputs.email)
        if (!email) return null
        return { email }
      },
      mapOutput: (output) => {
        // Enrow returns a "valid" / "invalid" qualifier; anything else is inconclusive.
        const qualification = str(output.qualification).toLowerCase()
        if (qualification === 'valid') return { status: 'valid', deliverable: true }
        if (qualification === 'invalid') return { status: 'invalid', deliverable: false }
        return null
      },
    }),
  ],
}
