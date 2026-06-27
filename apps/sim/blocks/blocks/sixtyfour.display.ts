import { SixtyfourIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SixtyfourBlockDisplay = {
  type: 'sixtyfour',
  name: 'Sixtyfour AI',
  description: 'Enrich leads and companies with AI-powered research',
  category: 'tools',
  bgColor: '#000000',
  icon: SixtyfourIcon,
  longDescription:
    'Find emails, phone numbers, and enrich lead or company data with contact information, social profiles, and detailed research using Sixtyfour AI.',
  docsLink: 'https://docs.sim.ai/integrations/sixtyfour',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const SixtyfourBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://sixtyfour.ai',
  templates: [
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour contact researcher',
      prompt:
        'Build a workflow that runs Sixtyfour AI on inbound leads, enriches with deep research-grade signals, and writes a research brief into the CRM contact record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour account intelligence',
      prompt:
        'Create a workflow that for tracked accounts runs Sixtyfour deep research weekly, surfaces new signals, and writes the digest into a research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour outbound briefer',
      prompt:
        'Build a workflow that runs Sixtyfour on a prospect, generates a tailored outreach brief with hooks, and queues it for the rep to send via Email Bison.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour event-attendee researcher',
      prompt:
        'Create a workflow that takes a Luma event attendee list, runs Sixtyfour deep research per attendee, and writes per-person briefs for the sales team.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['luma'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour competitor-intel digest',
      prompt:
        'Build a scheduled weekly workflow that runs Sixtyfour deep research on competitors and writes a competitive-intel digest to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour CRM enricher',
      prompt:
        'Create a scheduled workflow that finds CRM accounts missing deep-research signals, runs Sixtyfour, and writes the structured findings back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour deal-prep packet',
      prompt:
        'Build a workflow that runs Sixtyfour the morning of every meeting, generates a meeting-prep packet with company and attendee research, and emails the rep.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'enrich-lead',
      description:
        'Enrich a single lead with Sixtyfour AI research to fill in role, company, and contact context.',
      content:
        '# Enrich Lead\n\nTurn a thin lead record into a researched profile.\n\n## Steps\n1. Run Enrich Lead with whatever you know about the person: name, company, email, or LinkedIn.\n2. Request only the fields you need to keep credit usage down.\n3. Review the returned profile: title, seniority, company, and any social or contact data.\n\n## Output\nReturn the enriched lead profile with the discovered role, company, and context, and note any fields the research could not resolve.',
    },
    {
      name: 'find-contact-details',
      description: 'Find a verified email or phone number for a prospect using Sixtyfour AI.',
      content:
        '# Find Contact Details\n\nLocate a reachable email or phone number for a prospect.\n\n## Steps\n1. Provide the person identity you have: name plus company or domain.\n2. Run Find Email to discover a work email, or Find Phone for a phone number. Choose the professional or personal type as appropriate.\n3. Validate that the result matches the intended person before using it.\n\n## Output\nReturn the discovered email or phone number with its type, and clearly state if no verified contact could be found.',
    },
    {
      name: 'enrich-company',
      description:
        'Research a company with Sixtyfour AI to build a firmographic and account-context profile.',
      content:
        '# Enrich Company\n\nBuild an account profile for a target company.\n\n## Steps\n1. Run Enrich Company with the company name or domain.\n2. Request the firmographic fields you need: industry, size, location, funding, and technologies in use.\n3. Use the result to qualify the account against your ideal customer profile.\n\n## Output\nReturn the company profile with industry, size, location, and notable signals, plus a short note on how well it fits the target profile.',
    },
  ],
} as const satisfies BlockMeta
