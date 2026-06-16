import { sleep } from '@sim/utils/helpers'
import { icypeasHosting } from '@/tools/icypeas/hosting'
import type {
  IcypeasFindEmailOutput,
  IcypeasFindEmailParams,
  IcypeasFindEmailResponse,
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

/** Icypeas statuses that indicate a result was actually found. */
const FOUND_STATUSES = new Set(['FOUND', 'DEBITED'])

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = 120000

/** Map a raw Icypeas item object to the tool output shape. */
function mapItem(item: Record<string, unknown>): IcypeasFindEmailOutput {
  const status = (item.status as string | undefined) ?? null
  // Results are nested under item.results; emails are in item.results.emails[0].email
  const results = (item.results as Record<string, unknown> | undefined) ?? {}
  const emails = Array.isArray(results.emails) ? (results.emails as Record<string, unknown>[]) : []
  const email = (emails[0]?.email as string | undefined) ?? null
  const firstname = (results.firstname as string | undefined) ?? null
  const lastname = (results.lastname as string | undefined) ?? null
  return {
    searchId: (item._id as string | undefined) ?? null,
    status,
    email,
    firstname,
    lastname,
    item,
  }
}

export const icypeasFindEmailTool: ToolConfig<IcypeasFindEmailParams, IcypeasFindEmailResponse> = {
  id: 'icypeas_find_email',
  name: 'Icypeas Find Email',
  description:
    'Find a professional email address from a first name, last name, and company domain or name. Submits the search and polls until a result is available. Costs 1 credit per found email (https://www.icypeas.com/pricing).',
  version: '1.0.0',

  hosting: icypeasHosting<IcypeasFindEmailParams>((_params, output) => {
    const status = output.status as string | undefined
    // 1 credit charged only when a result is found (FOUND / DEBITED status).
    return status && FOUND_STATUSES.has(status) ? 1 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Icypeas API key',
    },
    firstname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Target person's first name",
    },
    lastname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Target person's last name",
    },
    domainOrCompany: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target company domain (e.g. stripe.com) or company name (e.g. Stripe)',
    },
  },

  request: {
    url: 'https://app.icypeas.com/api/email-search',
    method: 'POST',
    headers: (params: IcypeasFindEmailParams) => ({
      Authorization: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params: IcypeasFindEmailParams) => {
      const body: Record<string, unknown> = {
        domainOrCompany: params.domainOrCompany,
      }
      if (params.firstname) body.firstname = params.firstname
      if (params.lastname) body.lastname = params.lastname
      return body
    },
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
      throw new Error('Icypeas email-search did not return an item _id')
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
      throw new Error('Icypeas find-email result is missing a searchId')
    }

    // If already terminal (unlikely on submit but defensive), return immediately.
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
      // Poll response: { success: true, item: { _id: '...', status: '...', results: { emails: [...], firstname, lastname } } }
      const item = (json.item as Record<string, unknown> | undefined) ?? {}
      const status = (item.status as string | undefined) ?? null

      if (status && TERMINAL_STATUSES.has(status)) {
        // Any terminal status is a successful run — a clean no-match is not a
        // failure. The enrichment cascade only calls mapOutput when success is
        // true, so returning false would skip the verdict and inflate the
        // runner's error count. A null email signals "not found" downstream.
        return {
          success: true,
          output: mapItem(item),
        }
      }
    }

    throw new Error('Icypeas email-search did not complete within the polling window')
  },

  outputs: {
    searchId: ICYPEAS_SEARCH_ID_OUTPUT,
    status: ICYPEAS_STATUS_OUTPUT,
    email: ICYPEAS_EMAIL_OUTPUT,
    firstname: {
      type: 'string',
      description: "Found person's first name",
      optional: true,
    },
    lastname: {
      type: 'string',
      description: "Found person's last name",
      optional: true,
    },
    item: ICYPEAS_ITEM_OUTPUT,
  },
}
