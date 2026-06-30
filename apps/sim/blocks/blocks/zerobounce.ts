import { ZeroBounceIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ZeroBounceResponse } from '@/tools/zerobounce/types'

export const ZeroBounceBlock: BlockConfig<ZeroBounceResponse> = {
  type: 'zerobounce',
  name: 'ZeroBounce',
  description: 'Validate email deliverability and check account credits',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate ZeroBounce to validate email deliverability in real time — detect invalid, catch-all, spamtrap, abuse, and do-not-mail addresses — and check your remaining validation credits.',
  docsLink: 'https://docs.sim.ai/integrations/zerobounce',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: ZeroBounceIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Verify Email', id: 'zerobounce_verify_email' },
        { label: 'Get Remaining Credits', id: 'zerobounce_get_credits' },
      ],
      value: () => 'zerobounce_verify_email',
    },
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'zerobounce_verify_email' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your ZeroBounce API key',
      password: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'zerobounce_get_credits', not: true },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your ZeroBounce API key',
      password: true,
      condition: { field: 'operation', value: 'zerobounce_get_credits' },
    },
  ],
  tools: {
    access: ['zerobounce_verify_email', 'zerobounce_get_credits'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'zerobounce_verify_email':
          case 'zerobounce_get_credits':
            return params.operation
          default:
            return 'zerobounce_verify_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params
        const idToParam: Record<string, string> = { ve_email: 'email' }
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          const mappedKey = idToParam[key] ?? key
          result[mappedKey] = value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'ZeroBounce API key' },
    ve_email: { type: 'string', description: 'Email address to validate' },
  },
  outputs: {
    email: { type: 'string', description: 'The validated email address' },
    status: { type: 'string', description: 'Validation status' },
    deliverable: {
      type: 'boolean',
      description: 'Whether the email is valid and safe to send',
    },
    subStatus: { type: 'string', description: 'Detailed sub-status' },
    freeEmail: { type: 'boolean', description: 'Whether on a free email provider' },
    didYouMean: { type: 'string', description: 'Suggested correction' },
    credits: { type: 'number', description: 'Remaining validation credits' },
  },
}

export const ZeroBounceBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.zerobounce.net',
} as const satisfies BlockMeta
