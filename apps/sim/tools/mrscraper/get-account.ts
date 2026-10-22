import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  MrScraperGetAccountParams,
  MrScraperGetAccountResponse,
} from '@/tools/mrscraper/types'
import {
  getMrScraperError,
  getMrScraperHeaders,
  requireMrScraperObject,
} from '@/tools/mrscraper/utils'
import type { ToolConfig } from '@/tools/types'

function getAccountNumber(value: unknown): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(number) ? number : 0
}

export const mrScraperGetAccountTool: ToolConfig<
  MrScraperGetAccountParams,
  MrScraperGetAccountResponse
> = {
  id: 'mrscraper_get_account',
  name: 'MrScraper Get Account',
  description:
    'Check account identity, subscription status, token usage, remaining quota, and rate limits.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MrScraper API key from https://app.mrscraper.com.',
    },
  },
  request: {
    method: 'GET',
    url: 'https://api.app.mrscraper.com/api/v1/subscription-accounts',
    headers: (params) => getMrScraperHeaders(params.apiKey),
  },
  transformResponse: async (response) => {
    const body = requireMrScraperObject(await response.json(), 'account response')
    const error = getMrScraperError(body)
    if (error) throw new Error(error)
    const account = requireMrScraperObject(body.data ?? body, 'account details')
    const user = toRecord(account.user)
    const tokenLimit = getAccountNumber(account.tokenLimit)
    const tokenUsage = getAccountNumber(account.tokenUsage)
    return {
      success: true,
      output: {
        subscriptionStatus: toStringOrNull(account.stripeStatus),
        enterprise: account.isEnterprise === true,
        tokenUsage,
        tokenLimit,
        tokenRemaining: Math.max(0, tokenLimit - tokenUsage),
        usagePercent: tokenLimit > 0 ? Math.round((tokenUsage / tokenLimit) * 10000) / 100 : 0,
        rateLimit: getAccountNumber(account.rateLimit),
        rateTtl: getAccountNumber(account.rateTtl),
        autoRenew: account.isAutoRenew === true,
        endsAt: toStringOrNull(account.endsAt),
        user: {
          name: toStringOrNull(user.name),
          email: toStringOrNull(user.email),
          verified: user.isVerified === true,
        },
      },
    }
  },
  outputs: {
    subscriptionStatus: {
      type: 'string',
      description: 'Current subscription status.',
      nullable: true,
    },
    enterprise: { type: 'boolean', description: 'Whether the account has an enterprise plan.' },
    tokenUsage: { type: 'number', description: 'Plan tokens already consumed.' },
    tokenLimit: { type: 'number', description: 'Plan token allowance.' },
    tokenRemaining: { type: 'number', description: 'Remaining plan tokens, clamped to zero.' },
    usagePercent: { type: 'number', description: 'Percentage of the token allowance consumed.' },
    rateLimit: { type: 'number', description: 'Account request rate limit.' },
    rateTtl: { type: 'number', description: 'Rate-limit window reported by the service.' },
    autoRenew: { type: 'boolean', description: 'Whether the subscription renews automatically.' },
    endsAt: {
      type: 'string',
      description: 'Subscription end timestamp, when present.',
      nullable: true,
    },
    user: {
      type: 'object',
      description: 'Account identity.',
      properties: {
        name: { type: 'string', description: 'Account holder name.', nullable: true },
        email: { type: 'string', description: 'Account holder email.', nullable: true },
        verified: { type: 'boolean', description: 'Whether the account holder is verified.' },
      },
    },
  },
}
