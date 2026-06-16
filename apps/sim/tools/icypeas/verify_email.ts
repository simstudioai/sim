import { sleep } from '@sim/utils/helpers'
import { icypeasHosting } from '@/tools/icypeas/hosting'
import type {
  IcypeasVerifyEmailOutput,
  IcypeasVerifyEmailParams,
  IcypeasVerifyEmailResponse,
} from '@/tools/icypeas/types'
import {
  ICYPEAS_EMAIL_OUTPUT,
  ICYPEAS_ITEM_OUTPUT,
  ICYPEAS_SEARCH_ID_OUTPUT,
  ICYPEAS_STATUS_OUTPUT,
} from '@/tools/icypeas/types'
import type { ToolConfig } from '@/tools/types'

/** Icypeas statuses that indicate the search has finished (success or failure). */
const TERMINAL_STATUSES = new Set([
  'FOUND',
  'DEBITED',
  'NOT_FOUND',
  'DEBITED_NOT_FOUND',
  'BAD_INPUT',
  'INSUFFICIENT_FUNDS',
  'ABORTED',
])

/** Icypeas statuses that indicate the email address is valid/deliverable. */
const VALID_STATUSES = new Set(['FOUND', 'DEBITED'])

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = 120000

/** Map a raw Icypeas item object to the verify-email output shape. */
function mapItem(item: Record<string, unknown>): IcypeasVerifyEmailOutput {
  const status = (item.status as string | undefined) ?? null
  // Verify payloads put the address on item.email; fall back to the nested
  // results.emails[0].email shape that some responses use.
  const results = (item.results as Record<string, unknown> | undefined) ?? {}
  const emails = Array.isArray(results.emails) ? (results.emails as Record<string, unknown>[]) : []
  const email =
    (item.email as string | undefined) ?? (emails[0]?.email as string | undefined) ?? null
  const valid = status !== null ? VALID_STATUSES.has(status) : null
  return {
    searchId: (item._id as string | undefined) ?? null,
    status,
    email,
    valid,
    item,
  }
}

export const icypeasVerifyEmailTool: ToolConfig<
  IcypeasVerifyEmailParams,
  IcypeasVerifyEmailResponse
> = {
  id: 'icypeas_verify_email',
  name: 'Icypeas Verify Email',
  description:
    'Verify whether an email address is valid and deliverable. Submits the verification and polls until a result is available. Costs 0.1 credit per verification (https://www.icypeas.com/pricing).',
  version: '1.0.0',

  hosting: icypeasHosting<IcypeasVerifyEmailParams>((_params, output) => {
    // 0.1 credit per verification that consumed credits: FOUND/DEBITED (verdict
    // delivered) and DEBITED_NOT_FOUND (debited even though unresolved).
    // BAD_INPUT / INSUFFICIENT_FUNDS / ABORTED / NOT_FOUND are never charged.
    const status = output.status as string | undefined
    if (!status) {
      throw new Error('Icypeas verify-email: cannot determine cost — status is missing')
    }
    const billable = status === 'FOUND' || status.includes('DEBITED')
    // 0.1 credit; express as a fractional number so ICYPEAS_CREDIT_USD math works.
    return billable ? 0.1 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Icypeas API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to verify (e.g. john@stripe.com)',
    },
  },

  request: {
    url: 'https://app.icypeas.com/api/email-verification',
    method: 'POST',
    headers: (params: IcypeasVerifyEmailParams) => ({
      Authorization: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params: IcypeasVerifyEmailParams) => ({
      email: params.email,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Icypeas API error: ${response.status} - ${errorText}`)
    }
    const json = (await response.json()) as Record<string, unknown>
    // Submit response: { success: true, item: { _id: '...', status: 'NONE', ... } }
    const item = (json.item as Record<string, unknown> | undefined) ?? {}
    const searchId = (item._id as string | undefined) ?? null
    if (!searchId) {
      throw new Error('Icypeas email-verification did not return an item _id')
    }
    return {
      success: true,
      output: mapItem(item),
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) return result

    const searchId = result.output.searchId
    if (!searchId) {
      throw new Error('Icypeas verify-email result is missing a searchId')
    }

    // If already terminal, return immediately.
    if (result.output.status && TERMINAL_STATUSES.has(result.output.status)) {
      return result
    }

    let elapsed = 0
    while (elapsed < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsed += POLL_INTERVAL_MS

      const pollResponse = await fetch('https://app.icypeas.com/api/bulk-single-searchs/read', {
        method: 'POST',
        headers: {
          Authorization: params.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: searchId }),
      })

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        throw new Error(`Icypeas poll error: ${pollResponse.status} - ${errorText}`)
      }

      const json = (await pollResponse.json()) as Record<string, unknown>
      // Poll response: { success: true, item: { _id: '...', status: '...', results: { emails: [...] } } }
      const item = (json.item as Record<string, unknown> | undefined) ?? {}
      const status = (item.status as string | undefined) ?? null

      if (status && TERMINAL_STATUSES.has(status)) {
        // Any terminal status is a successful run — NOT_FOUND/DEBITED_NOT_FOUND are
        // definitive verdicts, not failures. The enrichment cascade only calls
        // mapOutput when success is true, so returning false here would skip those
        // verdicts and inflate the runner's error count. `valid` carries the result.
        return {
          success: true,
          output: mapItem(item),
        }
      }
    }

    throw new Error('Icypeas email-verification did not complete within the polling window')
  },

  outputs: {
    searchId: ICYPEAS_SEARCH_ID_OUTPUT,
    status: ICYPEAS_STATUS_OUTPUT,
    email: ICYPEAS_EMAIL_OUTPUT,
    valid: {
      type: 'boolean',
      description: 'Whether the email is valid/deliverable (true for FOUND/DEBITED status)',
      optional: true,
    },
    item: ICYPEAS_ITEM_OUTPUT,
  },
}
