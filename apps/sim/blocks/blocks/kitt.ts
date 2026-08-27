import { KittIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { KittResponse } from '@/tools/kitt/types'

export const KittBlock: BlockConfig<KittResponse> = {
  type: 'kitt',
  name: 'Kitt',
  description: 'Find and verify B2B email addresses',
  longDescription:
    'Integrate Kitt to find a verified work email from a full name and company domain or to verify an existing B2B email with email-server and identity-server checks.',
  docsLink: 'https://docs.sim.ai/integrations/kitt',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#8064E8',
  icon: KittIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Kitt',
    sentences: {
      byOperation: {
        kitt_find_email: [
          { text: 'Find the verified work email for', field: 'fe_fullName', core: true },
          { text: 'at', field: 'fe_domain' },
        ],
        kitt_verify_email: [{ text: 'Verify', field: 've_email', after: 'with Kitt', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email', id: 'kitt_find_email' },
        { label: 'Verify Email', id: 'kitt_verify_email' },
      ],
      value: () => 'kitt_find_email',
    },
    {
      id: 'fe_fullName',
      title: 'Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'Erol Toker',
      condition: { field: 'operation', value: 'kitt_find_email' },
    },
    {
      id: 'fe_domain',
      title: 'Company Domain or Website',
      type: 'short-input',
      required: true,
      placeholder: 'trykitt.ai',
      condition: { field: 'operation', value: 'kitt_find_email' },
    },
    {
      id: 'fe_linkedinStandardProfileURL',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/eroltoker',
      condition: { field: 'operation', value: 'kitt_find_email' },
      mode: 'advanced',
    },
    {
      id: 'fe_strictNameMatches',
      title: 'Strict Name Matches',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'kitt_find_email' },
      mode: 'advanced',
    },
    {
      id: 'fe_customData',
      title: 'Custom Metadata',
      type: 'short-input',
      placeholder: 'crm-record-123',
      condition: { field: 'operation', value: 'kitt_find_email' },
      mode: 'advanced',
    },
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'erol@trykitt.ai',
      condition: { field: 'operation', value: 'kitt_verify_email' },
    },
    {
      id: 've_treatAliasesAsValid',
      title: 'Treat Aliases as Valid',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'kitt_verify_email' },
      mode: 'advanced',
    },
    {
      id: 've_customData',
      title: 'Custom Metadata',
      type: 'short-input',
      placeholder: 'crm-record-456',
      condition: { field: 'operation', value: 'kitt_verify_email' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Kitt API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['kitt_find_email', 'kitt_verify_email'],
    config: {
      tool: (params) => {
        if (params.operation === 'kitt_find_email') return 'kitt_find_email'
        if (params.operation === 'kitt_verify_email') return 'kitt_verify_email'
        throw new Error(`Unsupported Kitt operation: ${String(params.operation)}`)
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params
        const idToParam: Record<string, string> = {
          fe_customData: 'customData',
          fe_domain: 'domain',
          fe_fullName: 'fullName',
          fe_linkedinStandardProfileURL: 'linkedinStandardProfileURL',
          fe_strictNameMatches: 'strictNameMatches',
          ve_customData: 'customData',
          ve_email: 'email',
          ve_treatAliasesAsValid: 'treatAliasesAsValid',
        }
        const booleanFields = new Set(['strictNameMatches', 'treatAliasesAsValid'])
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          const mappedKey = idToParam[key] ?? key
          result[mappedKey] = booleanFields.has(mappedKey)
            ? value === true || value === 'true'
            : value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Kitt API key' },
    fe_fullName: { type: 'string', description: 'Full name for the email search' },
    fe_domain: { type: 'string', description: 'Company domain or website for the email search' },
    fe_linkedinStandardProfileURL: {
      type: 'string',
      description: 'LinkedIn profile URL for the email search',
    },
    fe_strictNameMatches: {
      type: 'boolean',
      description: 'Whether to require strict name matches',
    },
    fe_customData: { type: 'string', description: 'Custom finder request metadata' },
    ve_email: { type: 'string', description: 'Email address to verify' },
    ve_treatAliasesAsValid: {
      type: 'boolean',
      description: 'Whether forwarding aliases should count as valid',
    },
    ve_customData: { type: 'string', description: 'Custom verification request metadata' },
  },
  outputs: {
    outcome: {
      type: 'string',
      description:
        'Kitt result outcome: success or no-results-found for finding; valid, valid-risky, invalid, or unknown for verification',
    },
    email: {
      type: 'string',
      description: 'Email address found or verified; null when no finder result exists',
    },
  },
}

export const KittBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://trykitt.ai',
  templates: [
    {
      icon: KittIcon,
      title: 'Kitt work email finder',
      prompt:
        'Build a workflow that reads a person name and company domain from each table row, finds the verified work email with Kitt, and writes the outcome and email back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: KittIcon,
      title: 'Kitt email list verifier',
      prompt:
        'Create a workflow that verifies every B2B email in a table with Kitt, groups the rows by valid, valid-risky, invalid, or unknown outcome, and records each verdict.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'data-quality'],
    },
    {
      icon: KittIcon,
      title: 'Kitt HubSpot gap filler',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts missing a work email, uses their name and company domain with Kitt, and updates only contacts with a successful result.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: KittIcon,
      title: 'Kitt inbound lead validator',
      prompt:
        'Build a workflow that receives inbound lead data, verifies the submitted business email with Kitt, routes invalid addresses for review, and forwards valid leads to the sales workflow.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'lead-routing'],
    },
    {
      icon: KittIcon,
      title: 'Kitt Apollo prospect builder',
      prompt:
        'Build a workflow that takes Apollo prospects, finds missing verified work emails with Kitt, verifies existing emails, and saves only usable outcomes to a prospect table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'prospecting'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: KittIcon,
      title: 'Kitt recruiting outreach verifier',
      prompt:
        'Create a workflow that reads candidate work emails from Greenhouse, verifies each address with Kitt before recruiter outreach, and flags invalid or unknown outcomes for manual review.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['recruiting', 'data-quality'],
      alsoIntegrations: ['greenhouse'],
    },
    {
      icon: KittIcon,
      title: 'Kitt CRM hygiene monitor',
      prompt:
        'Create a scheduled workflow that re-verifies recently changed CRM email addresses with Kitt, records the exact outcome, and creates a cleanup queue for invalid and unknown records.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['crm', 'automation'],
    },
  ],
  skills: [
    {
      name: 'find-verified-work-email',
      description: 'Find a verified B2B email from a person name and company domain.',
      content:
        '# Find a Verified Work Email\n\nUse Kitt when a workflow has a person name and company domain or website but needs a verified work email.\n\n## Steps\n1. Preserve the full name exactly as provided by the source.\n2. Submit the name and company domain to Kitt Find Email.\n3. Provide the LinkedIn profile URL when it is available.\n4. Treat `success` as a match and `no-results-found` as a definitive no-match.\n\n## Output\nReturn the outcome and the found email. Never synthesize an address when Kitt returns no result.',
    },
    {
      name: 'verify-b2b-email',
      description: 'Verify a business email and interpret Kitt outcomes safely.',
      content:
        "# Verify a B2B Email\n\nUse Kitt Verify Email before sending or persisting an untrusted business email.\n\n## Steps\n1. Submit the email without changing its local part or domain.\n2. Record Kitt's exact outcome: `valid`, `valid-risky`, `invalid`, or `unknown`.\n3. Treat aliases as valid only when the workflow explicitly allows forwarding addresses.\n4. Route `invalid` and `unknown` outcomes according to the workflow's review policy.\n\n## Output\nReturn the original email and exact Kitt outcome without collapsing risky or unknown into valid.",
    },
    {
      name: 'clean-outbound-email-list',
      description: 'Classify an outbound list with Kitt before campaign enrollment.',
      content:
        '# Clean an Outbound Email List\n\nVerify each address with Kitt before adding contacts to an outbound campaign.\n\n## Steps\n1. Verify every email independently.\n2. Store the exact result beside the source row.\n3. Keep `valid` contacts in the send-ready set.\n4. Put `valid-risky` contacts into a separate policy-controlled set.\n5. Exclude `invalid` contacts and review `unknown` contacts.\n\n## Output\nReturn counts and rows for each of the four Kitt outcomes plus the send-ready set.',
    },
    {
      name: 'screen-forwarding-aliases',
      description: 'Reject forwarding aliases when current mailbox ownership matters.',
      content:
        '# Screen Forwarding Aliases\n\nUse Kitt alias handling when a workflow must distinguish a current mailbox owner from an address that forwards elsewhere.\n\n## Steps\n1. Verify the address with Treat Aliases as Valid set to No.\n2. Preserve the exact Kitt outcome.\n3. Keep `valid` and policy-approved `valid-risky` results.\n4. Route `invalid` and `unknown` results for review instead of assuming the named person still owns the mailbox.\n\n## Output\nReturn the email, exact outcome, and the routing decision.',
    },
    {
      name: 'triage-catchall-email-results',
      description: 'Separate unknown catchall results from conclusive verification outcomes.',
      content:
        '# Triage Catchall Email Results\n\nUse Kitt outcomes to keep inconclusive catchall addresses out of conclusive valid or invalid buckets.\n\n## Steps\n1. Verify each address with Kitt.\n2. Route `unknown` outcomes into a dedicated catchall review queue.\n3. Keep `valid-risky` separate from both `valid` and `unknown`.\n4. Preserve the original email and exact outcome for later policy decisions.\n\n## Output\nReturn conclusive, risky, and catchall-review groups with their source emails.',
    },
  ],
} as const satisfies BlockMeta
