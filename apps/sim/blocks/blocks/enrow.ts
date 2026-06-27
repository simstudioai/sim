import { EnrowBlockDisplay } from '@/blocks/blocks/enrow.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { EnrowResponse } from '@/tools/enrow/types'

export const EnrowBlock: BlockConfig<EnrowResponse> = {
  ...EnrowBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email', id: 'enrow_find_email' },
        { label: 'Verify Email', id: 'enrow_verify_email' },
      ],
      value: () => 'enrow_find_email',
    },

    // --- Find Email ---
    {
      id: 'fullname',
      title: 'Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'enrow_find_email' },
    },
    {
      id: 'company_domain',
      title: 'Company Domain',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'enrow_find_email' },
    },
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Stripe (used when domain is unavailable)',
      condition: { field: 'operation', value: 'enrow_find_email' },
      mode: 'advanced',
    },

    // --- Verify Email ---
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'enrow_verify_email' },
    },

    // --- API Key (hidden on hosted Sim for operations with hosted-key support) ---
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Enrow API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['enrow_find_email', 'enrow_verify_email'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'enrow_find_email':
          case 'enrow_verify_email':
            return params.operation
          default:
            return 'enrow_find_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params

        // Map unique subBlock IDs back to tool param names
        const idToParam: Record<string, string> = {
          ve_email: 'email',
        }

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
    apiKey: { type: 'string', description: 'Enrow API key' },
    fullname: { type: 'string', description: 'Full name for email search' },
    company_domain: { type: 'string', description: 'Company domain for email search' },
    company_name: { type: 'string', description: 'Company name for email search' },
    ve_email: { type: 'string', description: 'Email address to verify' },
  },
  outputs: {
    id: { type: 'string', description: 'Enrow job identifier' },
    email: { type: 'string', description: 'Email address found or verified' },
    qualification: { type: 'string', description: '"valid" or "invalid"' },
    fullname: { type: 'string', description: 'Full name of the person (find only)' },
    company_name: { type: 'string', description: 'Company name (find only)' },
    company_domain: { type: 'string', description: 'Company domain (find only)' },
    linkedin_url: { type: 'string', description: 'LinkedIn URL of the person (find only)' },
  },
}
