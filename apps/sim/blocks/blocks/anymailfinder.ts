import { AnymailFinderIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

export const AnymailFinderBlock: BlockConfig = {
  type: 'anymailfinder',
  name: 'Anymail Finder',
  description: 'Find and verify B2B work emails, paying only for verified results',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Anymail Finder to find verified work emails from a name and company or a LinkedIn URL, find the decision maker in a department at a company, list verified emails at a company, verify addresses you already have, and check your credit balance. A find is charged only when it returns a verified email.',
  docsLink: 'https://docs.sim.ai/integrations/anymailfinder',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#0E2240',
  icon: AnymailFinderIcon,
  canvasPresentation: {
    defaultTitle: 'Anymail Finder',
    sentences: {
      byOperation: {
        anymailfinder_find_person_email: [
          { text: 'Find the verified email for', field: 'fpe_full_name', core: true },
          { text: 'at', field: 'fpe_domain' },
          { text: ', or from LinkedIn profile', field: 'fpe_linkedin_url' },
        ],
        anymailfinder_find_decision_maker_email: [
          { text: 'Find a decision maker in', field: 'decision_maker_category', core: true },
          { text: 'at', field: 'fdm_domain' },
        ],
        anymailfinder_find_company_emails: [
          { text: 'List verified emails at', field: 'fce_domain', core: true },
          { text: ', of type', field: 'email_type' },
        ],
        anymailfinder_verify_email: [
          { text: 'Verify deliverability of', field: 've_email', core: true },
        ],
        anymailfinder_get_account: ['Read the remaining credit balance'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Person Email', id: 'anymailfinder_find_person_email' },
        { label: 'Find Decision Maker Email', id: 'anymailfinder_find_decision_maker_email' },
        { label: 'Find Company Emails', id: 'anymailfinder_find_company_emails' },
        { label: 'Verify Email', id: 'anymailfinder_verify_email' },
        { label: 'Get Account Balance', id: 'anymailfinder_get_account' },
      ],
      value: () => 'anymailfinder_find_person_email',
    },
    // Find Person Email: name + company, or a LinkedIn URL on its own
    {
      id: 'fpe_full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Satya Nadella (not needed with a LinkedIn URL)',
      condition: { field: 'operation', value: 'anymailfinder_find_person_email' },
    },
    {
      id: 'fpe_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'microsoft.com (preferred over company name)',
      condition: { field: 'operation', value: 'anymailfinder_find_person_email' },
    },
    {
      id: 'fpe_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Microsoft (used only without a domain)',
      condition: { field: 'operation', value: 'anymailfinder_find_person_email' },
      mode: 'advanced',
    },
    {
      id: 'fpe_linkedin_url',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/satyanadella (alone, or with the name)',
      condition: { field: 'operation', value: 'anymailfinder_find_person_email' },
    },
    // Find Decision Maker Email
    {
      id: 'fdm_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'microsoft.com (preferred over company name)',
      condition: { field: 'operation', value: 'anymailfinder_find_decision_maker_email' },
    },
    {
      id: 'fdm_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Microsoft (used only without a domain)',
      condition: { field: 'operation', value: 'anymailfinder_find_decision_maker_email' },
      mode: 'advanced',
    },
    {
      id: 'decision_maker_category',
      title: 'Departments',
      type: 'long-input',
      required: true,
      placeholder: '["ceo", "finance"]',
      condition: { field: 'operation', value: 'anymailfinder_find_decision_maker_email' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of one to five Anymail Finder decision maker categories, tried in order, from: ceo, engineering, finance, hr, it, logistics, marketing, operations, buyer, sales. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'e.g. ceo, finance, sales',
      },
    },
    // Find Company Emails
    {
      id: 'fce_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'microsoft.com (preferred over company name)',
      condition: { field: 'operation', value: 'anymailfinder_find_company_emails' },
    },
    {
      id: 'fce_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Microsoft (used only without a domain)',
      condition: { field: 'operation', value: 'anymailfinder_find_company_emails' },
      mode: 'advanced',
    },
    {
      id: 'email_type',
      title: 'Email Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Generic (info@, sales@)', id: 'generic' },
        { label: 'Personal (named employees)', id: 'personal' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'anymailfinder_find_company_emails' },
      mode: 'advanced',
    },
    // Verify Email
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'anymailfinder_verify_email' },
    },
    // API Key: hidden on hosted Sim for operations with hosted-key support
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Anymail Finder API key',
      password: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'anymailfinder_get_account', not: true },
    },
    // API Key: always required for the balance lookup (reads the user's own account)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Anymail Finder API key',
      password: true,
      condition: { field: 'operation', value: 'anymailfinder_get_account' },
    },
  ],
  tools: {
    access: [
      'anymailfinder_find_person_email',
      'anymailfinder_find_decision_maker_email',
      'anymailfinder_find_company_emails',
      'anymailfinder_verify_email',
      'anymailfinder_get_account',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'anymailfinder_find_person_email':
          case 'anymailfinder_find_decision_maker_email':
          case 'anymailfinder_find_company_emails':
          case 'anymailfinder_verify_email':
          case 'anymailfinder_get_account':
            return params.operation
          default:
            return 'anymailfinder_find_person_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params

        // Map unique subBlock IDs back to tool param names
        const idToParam: Record<string, string> = {
          fpe_full_name: 'full_name',
          fpe_domain: 'domain',
          fpe_company_name: 'company_name',
          fpe_linkedin_url: 'linkedin_url',
          fdm_domain: 'domain',
          fdm_company_name: 'company_name',
          fce_domain: 'domain',
          fce_company_name: 'company_name',
          ve_email: 'email',
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          const mappedKey = idToParam[key] ?? key
          if (mappedKey === 'decision_maker_category') {
            if (Array.isArray(value)) {
              result[mappedKey] = value
            } else if (typeof value === 'string') {
              const trimmed = value.trim()
              if (trimmed.startsWith('[')) {
                try {
                  const parsed = JSON.parse(trimmed)
                  if (Array.isArray(parsed)) {
                    result[mappedKey] = parsed
                    continue
                  }
                } catch {
                  // fall through to comma-split
                }
              }
              result[mappedKey] = trimmed
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            }
          } else {
            result[mappedKey] = value
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Anymail Finder API key' },
    fpe_full_name: { type: 'string', description: 'Full name (find person email)' },
    fpe_domain: { type: 'string', description: 'Company domain (find person email)' },
    fpe_company_name: { type: 'string', description: 'Company name (find person email)' },
    fpe_linkedin_url: { type: 'string', description: 'LinkedIn profile URL (find person email)' },
    fdm_domain: { type: 'string', description: 'Company domain (find decision maker email)' },
    fdm_company_name: { type: 'string', description: 'Company name (find decision maker email)' },
    decision_maker_category: {
      type: 'array',
      description:
        'Departments to try in order (ceo, engineering, finance, hr, it, logistics, marketing, operations, buyer, sales)',
    },
    fce_domain: { type: 'string', description: 'Company domain (find company emails)' },
    fce_company_name: { type: 'string', description: 'Company name (find company emails)' },
    email_type: { type: 'string', description: 'any, generic or personal (find company emails)' },
    ve_email: { type: 'string', description: 'Email address to verify' },
  },
  outputs: {
    // Finds
    email: {
      type: 'string',
      description: 'Email address found, including risky ones that could not be verified',
    },
    valid_email: {
      type: 'string',
      description: 'The email only when email_status is valid; the one to send to',
    },
    email_status: {
      type: 'string',
      description:
        'Finds: valid, risky, not_found or blacklisted. Verification: valid, invalid or risky',
    },
    mx_domain: {
      type: 'string',
      description: 'Mail provider of the domain (google.com, outlook.com)',
    },
    mx_host: { type: 'string', description: 'Primary MX hostname of the domain' },
    person_full_name: { type: 'string', description: 'Full name of the matched person' },
    person_first_name: { type: 'string', description: 'First name (decision maker)' },
    person_last_name: { type: 'string', description: 'Last name (decision maker)' },
    person_job_title: { type: 'string', description: 'Job title of the matched person' },
    person_company_name: { type: 'string', description: 'Company name of the matched person' },
    person_linkedin_url: { type: 'string', description: 'LinkedIn profile URL (decision maker)' },
    decision_maker_category: {
      type: 'string',
      description: 'The requested department the decision maker was found in',
    },
    // Company emails
    emails: { type: 'array', description: 'Email addresses found at the company (up to 20)' },
    valid_emails: {
      type: 'array',
      description: 'The verified subset of emails; the ones to send to',
    },
    // Billing
    credits_charged: {
      type: 'number',
      description: 'Credits charged for this call (0 on a miss or a 30-day repeat)',
    },
    // Account
    credits_left: { type: 'number', description: 'Remaining credits on the account' },
    account_email: { type: 'string', description: 'Login email of the account owner' },
  },
}

export const AnymailFinderBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://anymailfinder.com',
  templates: [
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder email finder',
      prompt:
        'Build a workflow that takes a prospect name and company domain from a table, runs Anymail Finder to find the verified work email, and writes the address back to the row only when email_status is valid.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder LinkedIn enricher',
      prompt:
        'Create a workflow that takes a list of LinkedIn profile URLs, finds each verified work email with Anymail Finder, and writes the name, title, company and email into a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder decision maker finder',
      prompt:
        'Build a workflow that takes a list of company domains, uses Anymail Finder to find the CEO or head of finance at each with a verified email, and writes the name, title and email into an account table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder email verifier',
      prompt:
        'Build a workflow that runs a list of email addresses through Anymail Finder verification, removes invalid addresses, flags risky ones for review, and writes a clean list for outbound sends.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder CRM gap-filler',
      prompt:
        'Build a scheduled workflow that finds HubSpot contacts missing an email, looks each one up with Anymail Finder by name and company domain, and updates the contact record when a verified email comes back.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder inbound lead router',
      prompt:
        'Create a workflow that takes the company domain from an inbound form submission, uses Anymail Finder to find the sales or marketing decision maker there, and posts the contact to a Slack channel for follow-up.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AnymailFinderIcon,
      title: 'Anymail Finder company contact list',
      prompt:
        'Build a workflow that takes a target company domain, lists the verified email addresses Anymail Finder knows at that company, splits generic and personal addresses, and writes them to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'find-verified-work-email',
      description:
        'Find a prospect verified work email from their name and company, or from a LinkedIn URL.',
      content:
        '# Find Verified Work Email\n\nUse Anymail Finder to get a deliverable work email for a prospect.\n\n## Steps\n1. Use Find Person Email with the full name and the company domain (preferred) or company name. If you only have a LinkedIn profile URL, send that on its own; if you have both, send both.\n2. Read email_status. Only "valid" means the address was verified; use valid_email as the address to contact. A "risky" result is returned in email but could not be verified, and "not_found" means nothing was found.\n3. Record the matched name, title and company when the response includes them.\n\n## Output\nReturn the verified email with the matched name and company. If the status is not valid, say that no verified email was found rather than passing on an unverified address.',
    },
    {
      name: 'find-decision-maker',
      description:
        'Find the right person to contact at a company by department when you do not know their name, with a verified email.',
      content:
        '# Find Decision Maker\n\nUse Anymail Finder to identify who to contact at a company when you only know the department.\n\n## Steps\n1. Use Find Decision Maker Email with the company domain and one to five departments in priority order, for example ["ceo", "finance"]. The departments are ceo, engineering, finance, hr, it, logistics, marketing, operations, buyer and sales.\n2. The response returns one person: name, job title, LinkedIn URL and their verified email, plus which department matched.\n3. If email_status is not_found, try a different department order or a neighbouring department before giving up.\n\n## Output\nReturn the person name, title, LinkedIn URL, the department matched and the verified email. State clearly when no decision maker with a verified email was found.',
    },
    {
      name: 'verify-email-list',
      description:
        'Run a list of email addresses through Anymail Finder verification and split them into valid, invalid and risky.',
      content:
        '# Verify Email List\n\nUse Anymail Finder to clean a list before an outbound send.\n\n## Steps\n1. For each address, run Verify Email. Skip addresses that Anymail Finder itself returned from a find; those are already verified.\n2. Read email_status: valid (deliverable), invalid (does not exist or does not accept mail) or risky (could not be determined).\n3. Partition the list into the three groups.\n\n## Output\nReturn the valid list ready to send, the invalid list to drop, and the risky list for the user to decide on, with a count of each.',
    },
    {
      name: 'map-company-contacts',
      description:
        'List the verified email addresses known at a company and separate generic mailboxes from named employees.',
      content:
        '# Map Company Contacts\n\nUse Anymail Finder to see who can be reached at a company.\n\n## Steps\n1. Use Find Company Emails with the company domain. Use the email type filter to request only generic addresses (info@, sales@) or only individual employees when the task calls for one kind.\n2. Read valid_emails for the verified addresses; emails may also contain risky ones.\n3. For a specific person or department, follow up with Find Person Email or Find Decision Maker Email.\n\n## Output\nReturn the verified addresses grouped into generic mailboxes and named employees, and note that the list is capped at 20 addresses per call.',
    },
  ],
} as const satisfies BlockMeta
