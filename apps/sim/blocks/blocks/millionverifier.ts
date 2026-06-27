import { MillionVerifierBlockDisplay } from '@/blocks/blocks/millionverifier.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { MillionVerifierResponse } from '@/tools/millionverifier/types'

export const MillionVerifierBlock: BlockConfig<MillionVerifierResponse> = {
  ...MillionVerifierBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Verify Email', id: 'millionverifier_verify_email' },
        { label: 'Get Remaining Credits', id: 'millionverifier_get_credits' },
      ],
      value: () => 'millionverifier_verify_email',
    },
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'millionverifier_verify_email' },
    },
    // API Key — hidden on hosted Sim for operations with hosted-key support
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your MillionVerifier API key',
      password: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'millionverifier_get_credits', not: true },
    },
    // API Key — always required for the credit-balance lookup (no hosted key)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your MillionVerifier API key',
      password: true,
      condition: { field: 'operation', value: 'millionverifier_get_credits' },
    },
  ],
  tools: {
    access: ['millionverifier_verify_email', 'millionverifier_get_credits'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'millionverifier_verify_email':
          case 'millionverifier_get_credits':
            return params.operation
          default:
            return 'millionverifier_verify_email'
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
    apiKey: { type: 'string', description: 'MillionVerifier API key' },
    ve_email: { type: 'string', description: 'Email address to verify' },
  },
  outputs: {
    email: { type: 'string', description: 'The verified email address' },
    status: { type: 'string', description: 'Verification status' },
    deliverable: {
      type: 'boolean',
      description: 'Whether the email is valid and safe to send',
    },
    freeEmail: { type: 'boolean', description: 'Whether on a free email provider' },
    roleAccount: { type: 'boolean', description: 'Whether the address is a role account' },
    didYouMean: { type: 'string', description: 'Suggested correction' },
    subResult: { type: 'string', description: 'Additional classification detail' },
    credits: { type: 'number', description: 'Remaining verification credits' },
  },
}
