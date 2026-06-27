import { HunterIOIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const HunterBlockDisplay = {
  type: 'hunter',
  name: 'Hunter.io',
  description: 'Find and verify professional email addresses',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: HunterIOIcon,
  longDescription:
    'Integrate Hunter into the workflow. Can search domains, find email addresses, verify email addresses, discover companies, find companies, and count email addresses.',
  docsLink: 'https://docs.sim.ai/integrations/hunter',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const HunterBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://hunter.io',
  templates: [
    {
      icon: HunterIOIcon,
      title: 'Hunter email finder',
      prompt:
        'Build a workflow that takes a target company and role from a table, runs Hunter to find the matching email, validates it, and writes the verified contact back.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter email verifier',
      prompt:
        'Create a workflow that runs a list of email addresses through Hunter verification, removes invalid emails, and writes a clean list for outbound sends.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter + Email Bison outbound',
      prompt:
        'Build a workflow that uses Hunter to find prospect emails, validates each, and pushes valid prospects into an active Email Bison campaign.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter domain finder',
      prompt:
        'Create a workflow that takes a list of company names, finds the matching domains via Hunter, and enriches the rows so the CRM has accurate domain data.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter event-list enricher',
      prompt:
        'Build a workflow that takes a Luma event registrants list, finds their work emails via Hunter, and writes the verified emails into HubSpot for followup.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['luma', 'hubspot'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter CRM gap-filler',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts missing email addresses, looks them up via Hunter, validates each, and updates the contact record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: HunterIOIcon,
      title: 'Hunter + Apollo prospect builder',
      prompt:
        'Build a workflow that runs an Apollo search for an ICP, finds verified emails via Hunter, and writes the deliverable prospect list to a sender table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo'],
    },
  ],
  skills: [
    {
      name: 'find-decision-maker-emails',
      description:
        'Find verified email addresses for key roles at a target company using domain search.',
      content:
        '# Find Decision-Maker Emails\n\nGiven a company domain, find verified professional email addresses for the people who matter.\n\n## Steps\n1. Run a domain search for the target domain (e.g. example.com).\n2. Filter results by department or seniority (executive, sales, IT) to surface decision-makers.\n3. For each candidate, capture the full name, role, email, and confidence score.\n4. Drop any result below your confidence threshold (e.g. < 80).\n\n## Output\nReturn a list of contacts with name, title, email, and confidence score, sorted by seniority. Note the total emails available on the domain so the user knows coverage.',
    },
    {
      name: 'verify-email-list',
      description:
        'Verify a batch of email addresses and flag undeliverable or risky ones before sending.',
      content:
        '# Verify Email List\n\nClean a list of email addresses so a campaign only sends to deliverable inboxes.\n\n## Steps\n1. For each address, run the email verifier.\n2. Record the verification status (valid, invalid, accept-all, disposable, webmail) and the deliverability score.\n3. Bucket addresses into deliverable, risky, and undeliverable.\n\n## Output\nReturn the three buckets with counts, and a recommended clean list containing only deliverable addresses.',
    },
    {
      name: 'find-person-email',
      description: 'Find the most likely email address for a named person at a specific company.',
      content:
        '# Find a Person Email\n\nGiven a first name, last name, and company domain, find that person email address.\n\n## Steps\n1. Run the email finder with the full name and domain.\n2. Capture the returned email, confidence score, and the sources Hunter used.\n3. If confidence is low, optionally run a domain search to confirm the pattern.\n\n## Output\nReturn the email, confidence score, and supporting sources. State clearly when no confident match was found.',
    },
  ],
} as const satisfies BlockMeta
