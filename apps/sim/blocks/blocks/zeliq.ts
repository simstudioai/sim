import { ZeliqIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ZeliqResponse } from '@/tools/zeliq/types'

const EMAIL_OPERATION = 'zeliq_enrich_email'
const PHONE_OPERATION = 'zeliq_enrich_phone'

export const ZeliqBlock: BlockConfig<ZeliqResponse> = {
  type: 'zeliq',
  name: 'Zeliq',
  description: 'Queue waterfall enrichment for verified work emails and mobile phone numbers',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Use Zeliq to queue asynchronous work-email or mobile-phone enrichment from LinkedIn URLs and contact details. Zeliq posts completed enrichment data to the callback URL you provide.',
  docsLink: 'https://docs.sim.ai/integrations/zeliq',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: ZeliqIcon,
  canvasPresentation: {
    defaultTitle: 'Zeliq',
    sentences: {
      byOperation: {
        zeliq_enrich_email: [
          'Queue email enrichment',
          { text: 'for', field: ['emailLinkedInUrl', 'emailFirstName'] },
          { field: 'emailLastName' },
          { text: 'to', field: 'callbackUrl' },
        ],
        zeliq_enrich_phone: [
          'Queue phone enrichment',
          { text: 'for', field: ['phoneLinkedInUrl', 'phoneEmail'] },
          { text: 'to', field: 'callbackUrl' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Enrich Email', id: 'zeliq_enrich_email' },
        { label: 'Enrich Phone', id: 'zeliq_enrich_phone' },
      ],
      value: () => EMAIL_OPERATION,
    },
    {
      id: 'emailLookupMethod',
      title: 'Lookup Method',
      type: 'dropdown',
      options: [
        { label: 'LinkedIn URL', id: 'linkedin' },
        { label: 'Name and Company', id: 'person_details' },
      ],
      value: () => 'linkedin',
      condition: { field: 'operation', value: EMAIL_OPERATION },
    },
    {
      id: 'emailLinkedInUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/jane-doe',
      condition: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'linkedin' },
      },
      required: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'linkedin' },
      },
    },
    {
      id: 'emailFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      condition: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
      required: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
    },
    {
      id: 'emailLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
      required: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
    },
    {
      id: 'emailDomain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
      tooltip: 'Provide a company domain, a company name, or both.',
    },
    {
      id: 'emailCompany',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Example Inc',
      condition: {
        field: 'operation',
        value: EMAIL_OPERATION,
        and: { field: 'emailLookupMethod', value: 'person_details' },
      },
      tooltip: 'Provide a company name, a company domain, or both.',
    },
    {
      id: 'phoneLookupMethod',
      title: 'Lookup Method',
      type: 'dropdown',
      options: [
        { label: 'LinkedIn URL', id: 'linkedin' },
        { label: 'Email Address', id: 'email' },
      ],
      value: () => 'linkedin',
      condition: { field: 'operation', value: PHONE_OPERATION },
    },
    {
      id: 'phoneLinkedInUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/jane-doe',
      condition: {
        field: 'operation',
        value: PHONE_OPERATION,
        and: { field: 'phoneLookupMethod', value: 'linkedin' },
      },
      required: {
        field: 'operation',
        value: PHONE_OPERATION,
        and: { field: 'phoneLookupMethod', value: 'linkedin' },
      },
    },
    {
      id: 'phoneEmail',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'jane@example.com',
      condition: {
        field: 'operation',
        value: PHONE_OPERATION,
        and: { field: 'phoneLookupMethod', value: 'email' },
      },
      required: {
        field: 'operation',
        value: PHONE_OPERATION,
        and: { field: 'phoneLookupMethod', value: 'email' },
      },
    },
    {
      id: 'callbackUrl',
      title: 'Callback URL',
      type: 'short-input',
      placeholder: 'https://your-server.com/webhooks/zeliq-callback',
      required: true,
      tooltip: 'Zeliq posts the completed enrichment result to this URL asynchronously.',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Zeliq API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['zeliq_enrich_email', 'zeliq_enrich_phone'],
    config: {
      tool: (params) => {
        if (params.operation !== EMAIL_OPERATION && params.operation !== PHONE_OPERATION) {
          throw new Error(`Unsupported Zeliq operation: ${String(params.operation)}`)
        }
        return params.operation
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const idToParam: Record<string, string> = {
          emailLinkedInUrl: 'linkedinUrl',
          emailFirstName: 'firstName',
          emailLastName: 'lastName',
          emailCompany: 'company',
          emailDomain: 'domain',
          phoneLinkedInUrl: 'linkedinUrl',
          phoneEmail: 'email',
        }
        const uiOnlyFields = new Set(['operation', 'emailLookupMethod', 'phoneLookupMethod'])

        for (const [key, value] of Object.entries(params)) {
          if (uiOnlyFields.has(key) || value === undefined || value === null || value === '') {
            continue
          }
          result[idToParam[key] ?? key] = value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Zeliq enrichment operation' },
    emailLookupMethod: { type: 'string', description: 'Email lookup method' },
    emailLinkedInUrl: { type: 'string', description: 'LinkedIn URL for email enrichment' },
    emailFirstName: { type: 'string', description: 'First name for email enrichment' },
    emailLastName: { type: 'string', description: 'Last name for email enrichment' },
    emailDomain: { type: 'string', description: 'Company domain for email enrichment' },
    emailCompany: { type: 'string', description: 'Company name for email enrichment' },
    phoneLookupMethod: { type: 'string', description: 'Phone lookup method' },
    phoneLinkedInUrl: { type: 'string', description: 'LinkedIn URL for phone enrichment' },
    phoneEmail: { type: 'string', description: 'Email address for phone enrichment' },
    callbackUrl: { type: 'string', description: 'URL that receives the completed enrichment' },
    apiKey: { type: 'string', description: 'Zeliq API key' },
  },
  outputs: {
    status: { type: 'number', description: 'HTTP-style acceptance status (202)' },
    message: { type: 'string', description: 'Zeliq job acceptance message' },
    jobId: { type: 'string', description: 'Asynchronous Zeliq enrichment job ID' },
  },
}

export const ZeliqBlockMeta = {
  tags: ['enrichment', 'sales-engagement', 'webhooks'],
  url: 'https://www.zeliq.com',
  templates: [
    {
      icon: ZeliqIcon,
      title: 'Zeliq LinkedIn email finder',
      prompt:
        'Build a workflow that reads LinkedIn profile URLs from a table, queues Zeliq email enrichment for each row, and sends completed results to a webhook workflow that updates the table.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq CRM email enrichment',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts missing work emails, submits their names and company domains to Zeliq, and routes callbacks into a webhook workflow that updates HubSpot.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot', 'generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq phone waterfall',
      prompt:
        'Build a workflow that queues Zeliq phone enrichment from prospect LinkedIn URLs and directs completed mobile-number callbacks to a webhook workflow for CRM updates.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq event lead enricher',
      prompt:
        'Create a workflow that takes Luma registrants, queues Zeliq work-email enrichment using each name and company, and processes the callbacks into a qualified event-lead table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'events'],
      alsoIntegrations: ['luma', 'generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq form lead enrichment',
      prompt:
        'Build a workflow that receives Typeform leads, submits their email addresses to Zeliq phone enrichment, and handles completed callbacks in a webhook workflow before sales follow-up.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'forms'],
      alsoIntegrations: ['typeform', 'generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq spreadsheet enricher',
      prompt:
        'Create a workflow that reads prospect names and domains from Google Sheets, queues Zeliq email enrichment, and writes callback results into the matching spreadsheet rows.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'spreadsheet'],
      alsoIntegrations: ['google_sheets', 'generic_webhook'],
    },
    {
      icon: ZeliqIcon,
      title: 'Zeliq enrichment alerts',
      prompt:
        'Build a callback workflow that receives completed Zeliq email or phone enrichment, updates the matching prospect record, and alerts the sales team in Slack when verified contact data is found.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['generic_webhook', 'slack'],
    },
  ],
  skills: [
    {
      name: 'queue-zeliq-email-from-linkedin',
      description: 'Queue asynchronous Zeliq email enrichment from a LinkedIn profile URL.',
      content:
        '# Queue Zeliq Email from LinkedIn\n\nUse this when a verified work email is needed for a known LinkedIn profile.\n\n## Steps\n1. Collect the LinkedIn profile URL.\n2. Provide an HTTP or HTTPS callback URL that can accept Zeliq POST requests.\n3. Run `zeliq_enrich_email` with `linkedinUrl` and `callbackUrl`.\n4. Store the returned `jobId` so the submission can be traced.\n5. Process `credit_used` and `contact.emails` from the callback payload.\n\n## Output\nReturn the accepted job ID and callback destination.',
    },
    {
      name: 'queue-zeliq-email-from-identity',
      description: 'Queue Zeliq email enrichment from a person name and company.',
      content:
        '# Queue Zeliq Email from Identity\n\nUse this when no LinkedIn URL is available.\n\n## Steps\n1. Collect first name and last name.\n2. Collect either the company name or company domain.\n3. Provide the callback URL.\n4. Run `zeliq_enrich_email` without `linkedinUrl`.\n5. Record the accepted `jobId` and process the completed contact in the callback workflow.\n\n## Output\nReturn the accepted job ID and the identity fields submitted.',
    },
    {
      name: 'queue-zeliq-phone-enrichment',
      description: 'Queue Zeliq mobile-phone enrichment from LinkedIn or email.',
      content:
        '# Queue Zeliq Phone Enrichment\n\nUse this when a prospect needs a verified mobile number.\n\n## Steps\n1. Choose exactly one identifier: LinkedIn profile URL or email address.\n2. Provide an HTTP or HTTPS callback URL.\n3. Run `zeliq_enrich_phone`.\n4. Store the accepted `jobId`.\n5. Process `contact.most_probable_phone` and `contact.phones` from the callback payload.\n\n## Output\nReturn the accepted job ID and selected identifier.',
    },
    {
      name: 'design-zeliq-callback-workflow',
      description: 'Handle asynchronous Zeliq enrichment callbacks safely and deterministically.',
      content:
        '# Design a Zeliq Callback Workflow\n\nUse this because Zeliq enrichment completes asynchronously.\n\n## Steps\n1. Create a webhook endpoint and use its URL as `callbackUrl`.\n2. Include a stable contact identifier in the callback URL query string.\n3. Validate that the callback contains numeric `credit_used` and a `contact` object.\n4. Match the callback to the originating record.\n5. Update only fields present in the documented email or phone callback shape.\n\n## Output\nReturn the matched record identifier, consumed credits, and normalized contact data.',
    },
    {
      name: 'batch-submit-zeliq-enrichment',
      description: 'Submit table rows to Zeliq while respecting asynchronous callbacks and limits.',
      content:
        '# Batch Submit Zeliq Enrichment\n\nUse this for a table of prospects that needs email or phone enrichment.\n\n## Steps\n1. Select rows with the identifiers required by the chosen operation.\n2. Build a callback URL containing each row ID.\n3. Submit one Zeliq enrichment job per row at the configured workflow pace.\n4. Store every returned `jobId` on its source row.\n5. Let the callback workflow write completed results back to the matching rows.\n\n## Output\nReturn submitted row IDs, accepted job IDs, and any validation failures.',
    },
  ],
} as const satisfies BlockMeta
