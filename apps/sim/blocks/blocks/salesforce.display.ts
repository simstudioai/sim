import { SalesforceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SalesforceBlockDisplay = {
  type: 'salesforce',
  name: 'Salesforce',
  description: 'Interact with Salesforce CRM',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: SalesforceIcon,
  longDescription:
    'Integrate Salesforce into your workflow. Manage accounts, contacts, leads, opportunities, cases, and tasks, run reports and SOQL queries, and manage org schema by creating custom fields and objects via the Tooling API.',
  docsLink: 'https://docs.sim.ai/integrations/salesforce',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const SalesforceBlockMeta = {
  tags: ['sales-engagement', 'customer-support'],
  url: 'https://www.salesforce.com',
  templates: [
    {
      icon: SalesforceIcon,
      title: 'CRM knowledge search',
      prompt:
        'Create a knowledge base connected to my Salesforce account so all deals, contacts, notes, and activities are automatically synced and searchable. Then build an agent I can ask things like "what\'s the history with Acme Corp?" or "who was involved in the last enterprise deal?" and get instant answers with CRM record citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
    },
    {
      icon: SalesforceIcon,
      title: 'Deal pipeline tracker',
      prompt:
        'Create a table with columns for deal name, stage, amount, close date, and next steps. Build a workflow that syncs open deals from Salesforce into this table daily, and sends me a Slack summary each morning of deals that need attention or are at risk of slipping.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },

    {
      icon: SalesforceIcon,
      title: 'Push Salesforce pipeline updates to Slack',
      prompt:
        'Build a workflow that monitors Salesforce opportunities and posts a Slack notification to your sales team whenever a deal advances, closes, or needs immediate attention.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: SalesforceIcon,
      title: 'Inbound lead router',
      prompt:
        'Build a workflow that triggers on new inbound form submissions, creates a Salesforce lead with the captured fields, runs a SOQL query to check for an existing account match, assigns the lead to the right owner, and posts the new lead with its score to Slack.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SalesforceIcon,
      title: 'Salesforce case escalation',
      prompt:
        'Create a scheduled workflow that queries open Salesforce cases past their SLA, escalates each by updating its priority and owner, creates a follow-up task on the account, and Slacks the support lead a summary of everything that breached.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'crm', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SalesforceIcon,
      title: 'Salesforce report digest',
      prompt:
        'Build a scheduled workflow that runs a saved Salesforce report each morning, refreshes the linked dashboard, summarizes the key metrics and biggest movers with an agent, and emails the leadership team a written narrative of what changed.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'analysis'],
    },
    {
      icon: SalesforceIcon,
      title: 'Closed-won onboarding kickoff',
      prompt:
        'Create a workflow that watches Salesforce opportunities for stage changes to closed-won, pulls the related account and contacts, creates onboarding tasks for the CS owner, and writes a kickoff record into a tables-based project tracker.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'crm', 'automation'],
    },
  ],
  skills: [
    {
      name: 'capture-inbound-lead',
      description:
        'Create or update a Salesforce lead from an inbound signal and assign follow-up.',
      content:
        '# Capture Inbound Lead\n\nGet an inbound lead into Salesforce cleanly.\n\n## Steps\n1. Run get_leads to check for an existing lead with the same email.\n2. If new, run create_lead with name, company, email, and source; otherwise run update_lead to enrich it.\n3. Run create_task to assign a follow-up to the owner.\n\n## Output\nReturn the lead id, whether it was created or updated, and the follow-up task id.',
    },
    {
      name: 'log-opportunity-update',
      description: 'Advance a Salesforce opportunity stage and record the change for the account.',
      content:
        '# Log Opportunity Update\n\nKeep a deal current in Salesforce.\n\n## Steps\n1. Run get_opportunities to locate the deal.\n2. Run update_opportunity to set the new stage, amount, or close date.\n3. Run create_task to capture the next action.\n\n## Output\nReturn the opportunity id, its new stage, and the next-step task. Note if the stage moved to closed-won or closed-lost.',
    },
    {
      name: 'sync-account-contacts',
      description: 'Pull a Salesforce account with its contacts for a 360 view.',
      content:
        '# Sync Account Contacts\n\nAssemble a full picture of an account.\n\n## Steps\n1. Run get_accounts to resolve the target account.\n2. Run get_contacts filtered to the account to list its people.\n3. Optionally run get_opportunities and get_cases for active deals and support context.\n\n## Output\nReturn the account, its contacts with roles, and a summary of open opportunities and cases.',
    },
    {
      name: 'create-support-case',
      description: 'Open a Salesforce case for a customer issue and assign the owner.',
      content:
        '# Create Support Case\n\nFile a support case in Salesforce.\n\n## Steps\n1. Run get_contacts or get_accounts to link the case to the right record.\n2. Run create_case with subject, description, priority, and origin.\n3. Run create_task for the assigned owner if a follow-up is required.\n\n## Output\nReturn the case id, priority, and linked account or contact.',
    },
    {
      name: 'run-sales-report',
      description: 'Run a Salesforce report and summarize the results for a stakeholder.',
      content:
        '# Run Sales Report\n\nPull live numbers from a Salesforce report.\n\n## Steps\n1. Run list_reports to find the report, or use a known report id.\n2. Run run_report to execute it and capture the result set.\n3. Summarize the key metrics and notable changes.\n\n## Output\nReturn the headline metrics and a short narrative of what the report shows.',
    },
  ],
} as const satisfies BlockMeta
