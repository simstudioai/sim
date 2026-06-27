import { FindymailIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const FindymailBlockDisplay = {
  type: 'findymail',
  name: 'Findymail',
  description: 'Find and verify B2B emails, phones, employees, and company data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: FindymailIcon,
  longDescription:
    'Integrate Findymail to find verified work emails by name, domain, or LinkedIn URL, verify deliverability, reverse-lookup profiles from emails, enrich company data, find employees by job title, look up phone numbers, search technology stacks, and check credit usage.',
  docsLink: 'https://docs.sim.ai/integrations/findymail',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const FindymailBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.findymail.com',
  templates: [
    {
      icon: FindymailIcon,
      title: 'Findymail email finder',
      prompt:
        'Build a workflow that takes a prospect name and company domain from a table, runs Findymail to find the verified work email, and writes the deliverable contact back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail LinkedIn enricher',
      prompt:
        'Create a workflow that takes a list of LinkedIn profile URLs, finds the matching verified work email via Findymail, and writes the enriched contacts into a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail email verifier',
      prompt:
        'Build a workflow that runs a list of email addresses through Findymail verification, removes undeliverable addresses, and writes a clean list for outbound sends.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail company team mapper',
      prompt:
        'Create a workflow that takes a target company domain, uses Findymail to find employees by job title and enrich company data, and writes the org map into a tables-based account base.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail CRM gap-filler',
      prompt:
        'Build a scheduled workflow that finds HubSpot contacts missing verified emails, looks them up with Findymail, verifies each, and updates the contact record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail LinkedIn list builder',
      prompt:
        "Create a workflow that reads a list of LinkedIn profile URLs from a table, finds and verifies each prospect's work email and phone with Findymail, enriches their company, and writes a clean, ready-to-contact prospect table.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: FindymailIcon,
      title: 'Findymail domain prospecting',
      prompt:
        'Build a workflow that takes a target company domain, uses Findymail to find employees and their verified emails by role, validates each address, and pushes the qualified contacts into the outbound sequence.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'find-verified-email',
      description:
        'Find a prospect verified work email from their name and company, or from a LinkedIn URL.',
      content:
        '# Find Verified Email\n\nUse Findymail to discover a deliverable work email for a prospect.\n\n## Steps\n1. If you have a name plus company domain, use Find Email From Name. If you have a LinkedIn profile URL, use Find Email From LinkedIn.\n2. Findymail verifies the email at discovery time, so the returned address is already checked for deliverability.\n3. Capture the contact name, email, and domain from the response.\n\n## Output\nReturn the verified email, the matched contact name, and the source company domain. If no email was found, say so clearly rather than guessing an address.',
    },
    {
      name: 'verify-email-list',
      description:
        'Run a list of email addresses through Findymail verification and split into deliverable and undeliverable.',
      content:
        '# Verify Email List\n\nUse Findymail to clean an email list before an outbound send.\n\n## Steps\n1. For each email address, run Verify Email.\n2. Read the verified flag and the detected provider for each result.\n3. Partition the list into deliverable addresses and undeliverable ones.\n\n## Output\nReturn two lists: deliverable emails (with provider) and undeliverable emails. Include a short summary count so the caller knows how many were removed.',
    },
    {
      name: 'map-company-team',
      description:
        'Given a company domain, find employees by job title and enrich the company profile into a team map.',
      content:
        '# Map Company Team\n\nUse Findymail to build an org map for a target account.\n\n## Steps\n1. Use Get Company Info on the domain to pull industry, size, and description.\n2. Use Find Employees with the company website and a list of target job titles to pull matching people.\n3. Optionally find each contact verified email or phone for the highest-priority roles.\n\n## Output\nReturn the company profile plus a list of employees (name, job title, LinkedIn URL, and email where available), grouped by function so the account team can see the buying committee.',
    },
    {
      name: 'enrich-from-email',
      description:
        'Reverse-lookup an email address with Findymail to recover the full LinkedIn profile and current company.',
      content:
        '# Enrich From Email\n\nUse Findymail to turn a bare email address into a full contact record.\n\n## Steps\n1. Run Reverse Email Lookup on the email, requesting the full profile.\n2. Pull the full name, headline, job title, location, current company, and profile details.\n3. Optionally call Get Company Info on the recovered company domain for firmographics.\n\n## Output\nReturn a structured contact record: name, title, company, location, LinkedIn URL, and the original email. Note any fields the lookup could not resolve.',
    },
  ],
} as const satisfies BlockMeta
