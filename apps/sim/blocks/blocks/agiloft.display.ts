import { AgiloftIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AgiloftBlockDisplay = {
  type: 'agiloft',
  name: 'Agiloft',
  description: 'Manage records in Agiloft CLM',
  category: 'tools',
  bgColor: '#001028',
  icon: AgiloftIcon,
  longDescription:
    'Integrate with Agiloft contract lifecycle management to create, read, update, delete, and search records. Supports file attachments, SQL-based selection, saved searches, and record locking across any table in your knowledge base.',
  docsLink: 'https://docs.sim.ai/integrations/agiloft',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const AgiloftBlockMeta = {
  tags: ['automation'],
  url: 'https://www.agiloft.com',
  templates: [
    {
      icon: AgiloftIcon,
      title: 'Agiloft contract launcher',
      prompt:
        'Build a workflow that on a closed-won Salesforce opportunity creates an Agiloft contract record from the right template, fills key fields from the opportunity, and routes for legal review.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sales'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft clause analyzer',
      prompt:
        'Create a workflow that pulls Agiloft contracts on a schedule, extracts key clauses, writes deviations from the standard template to a legal review table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft renewal tracker',
      prompt:
        'Build a scheduled workflow that finds Agiloft contracts with renewals due in the next 90 days, creates a renewal-prep task in the CRM, and emails the account owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'legal'],
      alsoIntegrations: ['salesforce', 'gmail'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft approval router',
      prompt:
        'Create a scheduled workflow that searches Agiloft for contracts needing approval, posts a Microsoft Teams adaptive card to the approver, captures the decision, and updates Agiloft.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft compliance audit',
      prompt:
        'Build a scheduled monthly workflow that audits Agiloft contracts against compliance requirements, flags missing clauses or expired terms, and writes a remediation backlog.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft DocuSign bridge',
      prompt:
        'Create a scheduled workflow that searches Agiloft for contracts marked ready-to-sign, creates a DocuSign envelope from the template, sends it, and writes the envelope ID back to Agiloft.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'legal'],
      alsoIntegrations: ['docusign'],
    },
    {
      icon: AgiloftIcon,
      title: 'Agiloft + Linear ticket bridge',
      prompt:
        'Build a scheduled workflow that searches Agiloft for contracts flagged for engineering review and creates a Linear ticket with the contract context and a link, keeping status synced both ways.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['legal', 'engineering'],
      alsoIntegrations: ['linear'],
    },
  ],
  skills: [
    {
      name: 'flag-expiring-contracts',
      description:
        'Query Agiloft for contracts approaching their renewal or expiration date and report the ones at risk.',
      content:
        '# Flag Expiring Contracts\n\nFind contracts in Agiloft that are nearing expiration or auto-renewal so the team can act in time.\n\n## Steps\n1. Query the contract records for upcoming expiration or renewal dates within the target window.\n2. For each match, read key terms: counterparty, value, renewal type, and notice period.\n3. Identify contracts with auto-renewal clauses that need a decision before the notice deadline.\n\n## Output\nA list of at-risk contracts sorted by date, with counterparty, expiration date, renewal type, and recommended action.',
    },
    {
      name: 'create-contract-record',
      description:
        'Create a new contract or related record in Agiloft from provided deal or request details.',
      content:
        '# Create Contract Record\n\nAdd a new contract record to Agiloft from intake details.\n\n## Steps\n1. Map the provided details to the contract record fields (counterparty, type, value, start/end dates, owner).\n2. Set status to the correct initial stage in the lifecycle.\n3. Create the record and capture its ID.\n\n## Output\nConfirm the record was created with its ID and key fields. Note any required fields that were missing.',
    },
    {
      name: 'summarize-contract-terms',
      description:
        'Read a contract record in Agiloft and produce a plain-language summary of its key obligations and dates.',
      content:
        '# Summarize Contract Terms\n\nTurn an Agiloft contract record into a concise brief.\n\n## Steps\n1. Read the contract record and its key fields and attached terms.\n2. Identify obligations, payment terms, renewal/termination clauses, and critical dates.\n3. Note any unusual or high-risk terms.\n\n## Output\nA short brief: parties, term, value, key obligations, critical dates, and any risk flags. Keep it readable for non-lawyers.',
    },
  ],
} as const satisfies BlockMeta
