import { IcypeasBlockDisplay } from '@/blocks/blocks/icypeas.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { IcypeasResponse } from '@/tools/icypeas/types'

export const IcypeasBlock: BlockConfig<IcypeasResponse> = {
  ...IcypeasBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email', id: 'icypeas_find_email' },
        { label: 'Verify Email', id: 'icypeas_verify_email' },
      ],
      value: () => 'icypeas_find_email',
    },

    // -----------------------------------------------------------------------
    // Find Email
    // -----------------------------------------------------------------------
    {
      id: 'fe_firstname',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: 'icypeas_find_email' },
    },
    {
      id: 'fe_lastname',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: 'icypeas_find_email' },
    },
    {
      id: 'fe_domainOrCompany',
      title: 'Company Domain or Name',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'icypeas_find_email' },
    },

    // -----------------------------------------------------------------------
    // Verify Email
    // -----------------------------------------------------------------------
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@stripe.com',
      condition: { field: 'operation', value: 'icypeas_verify_email' },
    },

    // -----------------------------------------------------------------------
    // API Key — hidden on hosted Sim for all operations (hosted-key supported)
    // -----------------------------------------------------------------------
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Icypeas API key',
      password: true,
      hideWhenHosted: true,
    },
  ],

  tools: {
    access: ['icypeas_find_email', 'icypeas_verify_email'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'icypeas_find_email':
          case 'icypeas_verify_email':
            return params.operation
          default:
            return 'icypeas_find_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params

        // Map unique subBlock IDs back to tool param names.
        const idToParam: Record<string, string> = {
          fe_firstname: 'firstname',
          fe_lastname: 'lastname',
          fe_domainOrCompany: 'domainOrCompany',
          ve_email: 'email',
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          result[idToParam[key] ?? key] = value
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Icypeas API key' },
    fe_firstname: { type: 'string', description: "Person's first name (find email)" },
    fe_lastname: { type: 'string', description: "Person's last name (find email)" },
    fe_domainOrCompany: {
      type: 'string',
      description: 'Company domain or name (find email)',
    },
    ve_email: { type: 'string', description: 'Email address to verify' },
  },

  outputs: {
    searchId: {
      type: 'string',
      description: 'Icypeas internal search ID',
    },
    status: {
      type: 'string',
      description:
        'Terminal search status (FOUND, DEBITED, NOT_FOUND, DEBITED_NOT_FOUND, BAD_INPUT, INSUFFICIENT_FUNDS, ABORTED)',
    },
    email: {
      type: 'string',
      description: 'Email address found or verified',
    },
    firstname: {
      type: 'string',
      description: "Found person's first name (find-email only)",
    },
    lastname: {
      type: 'string',
      description: "Found person's last name (find-email only)",
    },
    valid: {
      type: 'boolean',
      description: 'Whether the email is valid/deliverable (verify-email only)',
    },
    item: {
      type: 'json',
      description: 'Full raw item object from the Icypeas results endpoint',
    },
  },
}
