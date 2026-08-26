import { EnrowIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { EnrowResponse } from '@/tools/enrow/types'

export const EnrowBlock: BlockConfig<EnrowResponse> = {
  type: 'enrow',
  name: 'Enrow',
  description: 'Find and verify B2B emails with triple-verified accuracy',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Enrow to find verified B2B email addresses from a full name and company, or verify the deliverability of an existing email. Enrow performs deterministic verifications including catch-all emails — no additional verifier needed.',
  docsLink: 'https://docs.sim.ai/integrations/enrow',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: EnrowIcon,
  canvasPresentation: {
    defaultTitle: 'Enrow',
    sentences: {
      byOperation: {
        enrow_find_email: [
          { text: 'Find email address for', field: 'fullname', core: true },
          { text: 'at', field: ['company_domain', 'company_name'] },
        ],
        enrow_verify_email: [{ text: 'Verify deliverability of', field: 've_email', core: true }],
      },
    },
  },
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
    firstname: { type: 'string', description: 'First name of the person (find only)' },
    lastname: { type: 'string', description: 'Last name of the person (find only)' },
    company_name: { type: 'string', description: 'Company name (find only)' },
    company_domain: { type: 'string', description: 'Company domain (find only)' },
  },
}

export const EnrowBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://enrow.io',
  templates: [
    {
      icon: EnrowIcon,
      title: 'Enrow email finder',
      prompt:
        'Build a workflow that reads a prospect full name and company domain from a table, finds the verified work email with Enrow, and writes the address and its qualification back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow list cleaner',
      prompt:
        'Create a workflow that runs every address in an email list through Enrow verification and writes only the deliverable ones into a clean sending table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow form-signup verifier',
      prompt:
        'Build a workflow that verifies each new signup email with Enrow when a form is submitted, and routes undeliverable addresses to a review queue instead of the CRM.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow CRM gap-filler',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts with no email, looks each one up in Enrow from the name and company domain, and updates the contact record when a valid address is found.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow bounce guard',
      prompt:
        "Build a scheduled workflow that re-verifies the contacts queued for this week's outbound send with Enrow and removes any address that no longer qualifies as valid.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow inbound-lead router',
      prompt:
        'Create a workflow that on a new inbound lead finds the work email with Enrow, verifies it, and posts the qualified contact to the sales channel in Slack.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EnrowIcon,
      title: 'Enrow find-and-verify pipeline',
      prompt:
        'Build a workflow that takes a list of names and companies, finds each work email with Enrow, verifies the result, and writes a ready-to-contact table with the qualification for every row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
} as const satisfies BlockMeta
