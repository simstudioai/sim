import { WizaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WizaBlockDisplay = {
  type: 'wiza',
  name: 'Wiza',
  description: 'Find, enrich, and verify B2B contact data with Wiza',
  category: 'tools',
  bgColor: '#9284BC',
  icon: WizaIcon,
  iconColor: '#9284BC',
  longDescription:
    'Integrates Wiza into the workflow. Search prospects, enrich companies, reveal verified emails and phone numbers for individuals, and check your account credit balance.',
  docsLink: 'https://docs.sim.ai/integrations/wiza',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const WizaBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://wiza.co',
  templates: [
    {
      icon: WizaIcon,
      title: 'Wiza prospect builder',
      prompt:
        'Build a workflow that runs a Wiza prospect search against my ICP filters, reveals verified emails and phone numbers for each match, and writes the prospect list into a sender table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza contact reveal',
      prompt:
        'Create a workflow that watches a leads table for new rows, runs a Wiza individual reveal to surface verified email and phone, and writes the contact details back to each row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza company enricher',
      prompt:
        'Build a workflow that takes a list of company domains, runs Wiza company enrichment, and writes firmographics and headcount into a tables-based research base.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza + Email Bison outbound',
      prompt:
        'Create a workflow that uses Wiza to find and reveal verified prospect emails, drafts a personalized first-touch message, and pushes valid prospects into an Email Bison campaign.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza CRM gap-filler',
      prompt:
        'Build a scheduled workflow that finds Salesforce contacts missing verified phone numbers, runs a Wiza reveal to fill the gaps, and updates each contact record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza credit monitor',
      prompt:
        'Create a scheduled workflow that checks the remaining Wiza credit balance each morning, logs the daily usage to a table, and posts a Slack alert when credits fall below the threshold so reveals never silently stall mid-campaign.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WizaIcon,
      title: 'Wiza to HubSpot pipeline',
      prompt:
        'Build a workflow that runs a Wiza prospect search for my target segment, reveals verified emails and phones for each match, and creates or updates the matching HubSpot contacts with the enriched fields and a lead-source tag.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'find-prospects',
      description:
        'Run a Wiza prospect search with filters to build a list of verified B2B contacts.',
      content:
        '# Find B2B Prospects with Wiza\n\nBuild a targeted list of verified prospects from an ideal-customer profile.\n\n## Steps\n1. Translate the ideal-customer profile into Wiza filters: job title, seniority, company size, industry, and location.\n2. Run the prospect-search operation with those filters and a sensible result limit.\n3. Choose how much contact data to reveal (email only, phone, or full) based on the outreach plan and credit budget.\n4. Collect the returned prospects with their verified contact fields.\n\n## Output\nReturn the matched prospects with name, title, company, and verified email or phone. Note the total matches and how many credits the reveal consumed.',
    },
    {
      name: 'enrich-company',
      description: 'Enrich a company by domain or name to retrieve firmographic data from Wiza.',
      content:
        '# Enrich a Company with Wiza\n\nFill in firmographic detail for a target account.\n\n## Steps\n1. Gather the company identifier you have, typically a domain or company name.\n2. Call the company-enrichment operation.\n3. Extract the returned firmographics: industry, size, location, revenue band, and website.\n\n## Output\nReturn the enriched company record as structured fields. If the company could not be matched, say so and report the input used.',
    },
    {
      name: 'reveal-contact-details',
      description:
        'Reveal verified email and phone for a known individual using Wiza individual reveal.',
      content:
        '# Reveal a Contact with Wiza\n\nGet verified contact details for a specific person.\n\n## Steps\n1. Provide the person identifiers you have, such as name and company or a LinkedIn profile.\n2. Decide the reveal level needed: email only, phone, or full contact.\n3. Call the individual-reveal operation.\n4. Capture the verified email, phone, and current role returned.\n\n## Output\nReturn the verified contact fields with a note on validation status. If credits are low, check the get-credits operation first and warn before spending.',
    },
  ],
} as const satisfies BlockMeta
