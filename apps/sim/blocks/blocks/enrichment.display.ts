import { EnrichmentIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const EnrichmentBlockDisplay = {
  type: 'enrichment',
  name: 'Data Enrichment',
  description: 'Enrich data with a Sim enrichment',
  category: 'blocks',
  bgColor: '#9333EA',
  icon: EnrichmentIcon,
  longDescription:
    'Run a Sim enrichment to look up data — work email, phone number, company domain, company info, and more — from the fields you map in. Uses the same provider cascade as table enrichments.',
  docsLink: 'https://docs.sim.ai/integrations/enrichment',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const EnrichmentBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  templates: [
    {
      icon: EnrichmentIcon,
      title: 'Work email finder',
      prompt:
        'Build a workflow that reads prospect rows with a full name and company domain from a table, runs the Work Email enrichment to find each verified work email, and writes the result back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Phone number lookup',
      prompt:
        "Create a workflow that takes a contact's full name and company domain, runs the Phone Number enrichment to find their direct phone, and appends the number to a call-list table for the SDR team.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Company domain resolver',
      prompt:
        'Build a workflow that reads a list of company names from a table, runs the Company Domain enrichment to resolve each website domain, and writes the matched domains back so later steps can enrich against them.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Company profile enricher',
      prompt:
        'Create a workflow that takes a company domain, runs the Company Info enrichment to pull industry, employee count, founded year, and description, and writes the firmographics into an accounts table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Name to full contact pipeline',
      prompt:
        'Build a workflow that takes a prospect name and company name, first runs the Company Domain enrichment to resolve the domain, then runs Work Email and Phone Number enrichments to find the verified email and phone, and writes a complete contact row to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Inbound lead qualifier',
      prompt:
        'Create a workflow that on a new inbound signup runs the Company Info enrichment on the email domain to pull industry and headcount, scores fit against my ICP with an agent, and routes qualified leads to the sales Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'enrichment'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EnrichmentIcon,
      title: 'CRM enrichment sweep',
      prompt:
        'Build a scheduled workflow that pulls HubSpot contacts missing a work email or phone, runs the Work Email and Phone Number enrichments to fill the gaps, and updates each record so the database stays ready for outbound.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Target account researcher',
      prompt:
        'Create a workflow that takes a company name, resolves its domain with the Company Domain enrichment, pulls firmographics with Company Info, and compiles an account brief into a file for reps to review before outreach.',
      modules: ['files', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'find-work-email',
      description:
        'Find a verified work email for a contact given their full name and company domain using the Work Email enrichment.',
      content:
        '# Find a Work Email\n\nResolve a verified work email for a prospect.\n\n## Steps\n1. Confirm you have the contact full name and the company domain (resolve the domain first if only a company name is given).\n2. Run the Work Email enrichment with name and domain.\n3. Capture the email and its verification confidence.\n\n## Output\nThe verified work email with its confidence level, or a clear note that no match was found.',
    },
    {
      name: 'enrich-company-profile',
      description:
        'Pull firmographics (industry, headcount, founded year, description) for a company domain using the Company Info enrichment.',
      content:
        '# Enrich a Company Profile\n\nBuild a firmographic profile for an account.\n\n## Steps\n1. Confirm the company domain (resolve it with the Company Domain enrichment if you only have a name).\n2. Run the Company Info enrichment on the domain.\n3. Capture industry, employee count, founded year, and description.\n\n## Output\nA structured company profile with the key firmographics, ready to write into an accounts record.',
    },
    {
      name: 'build-full-contact',
      description:
        'Take a prospect name and company, resolve the domain, then find the work email and phone to assemble a complete contact.',
      content:
        '# Build a Full Contact\n\nGo from a name and company to a complete, enriched contact.\n\n## Steps\n1. Run the Company Domain enrichment to resolve the company website domain.\n2. Run the Work Email enrichment using the name and resolved domain.\n3. Run the Phone Number enrichment for a direct phone.\n4. Assemble the results into one contact record.\n\n## Output\nA complete contact with name, company, domain, verified email, and phone, plus confidence for each field.',
    },
  ],
} as const satisfies BlockMeta
