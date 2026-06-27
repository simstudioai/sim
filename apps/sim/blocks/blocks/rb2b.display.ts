import { RB2BIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RB2BBlockDisplay = {
  type: 'rb2b',
  name: 'RB2B',
  description: 'Identify and enrich website visitors',
  category: 'tools',
  bgColor: '#51FF00',
  icon: RB2BIcon,
  longDescription:
    'Resolve IP addresses, hashed emails, and LinkedIn profiles into person-level identity and B2B enrichment data using the RB2B API. Convert IPs to hashed emails, MAIDs, and company domains; enrich emails into LinkedIn profiles, business profiles, and mobile IDs; and look up emails or phone numbers from LinkedIn. Requires an RB2B API key.',
  docsLink: 'https://docs.sim.ai/integrations/rb2b',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const RB2BBlockMeta = {
  tags: ['enrichment', 'sales-engagement', 'identity'],
  url: 'https://rb2b.com',
  templates: [
    {
      icon: RB2BIcon,
      title: 'Website visitor de-anonymizer',
      prompt:
        'Build a workflow that takes the IP addresses of anonymous website visitors, uses RB2B to resolve each IP to a hashed email and company domain, and writes the identified visitors into a table for the sales team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'identity', 'enrichment'],
    },
    {
      icon: RB2BIcon,
      title: 'Visitor IP to LinkedIn profile',
      prompt:
        'Create a workflow that resolves a visitor IP to a hashed email with RB2B, then enriches that hashed email into a LinkedIn profile and business profile so reps know exactly who visited.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'identity', 'research'],
    },
    {
      icon: RB2BIcon,
      title: 'Hashed email enrichment pipeline',
      prompt:
        'Build a workflow that reads hashed emails from a table, uses RB2B to enrich each into a full business profile with name, title, seniority, and company details, and writes the enriched records back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'research'],
    },
    {
      icon: RB2BIcon,
      title: 'LinkedIn to mobile phone finder',
      prompt:
        "Create a workflow that takes a list of LinkedIn profile slugs, uses RB2B to look up each prospect's mobile phone and best personal email, and writes a ready-to-contact table for outbound calling.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'research'],
    },
    {
      icon: RB2BIcon,
      title: 'Intent-to-CRM identity sync',
      prompt:
        'Build a workflow that resolves visitor IPs to company domains with RB2B, enriches the matched person into a business profile, and creates or updates the matching contact and company in HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'identity', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: RB2BIcon,
      title: 'High-intent visitor Slack alerts',
      prompt:
        'Create a workflow that reads a list of website visitor IPs, uses RB2B to resolve each person and their company, and posts an alert with the identified LinkedIn profile and company to the sales Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'identity', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RB2BIcon,
      title: 'LinkedIn slug resolver',
      prompt:
        'Build a workflow that takes a first name, last name, and company domain, uses RB2B LinkedIn slug search to resolve the matching profile, and enriches it into a business profile written to a prospect table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: RB2BIcon,
      title: 'Account engagement freshness sweep',
      prompt:
        'Create a scheduled workflow that runs my list of prospect emails through RB2B email-to-last-active-date lookups, flags recently active contacts, and logs the engagement snapshot to a table for prioritized follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
    },
  ],
  skills: [
    {
      name: 'identify-website-visitor',
      description: 'Resolve a visitor IP into a person and company profile for sales follow-up.',
      content:
        '# Identify Website Visitor\n\nTurn an anonymous visit into a named, enrichable lead.\n\n## Steps\n1. Take the visitor ip_address and run ip_to_company to resolve the firmographic match.\n2. Run ip_to_hem to obtain the hashed email identifier for the person.\n3. Run hem_to_business_profile and hem_to_best_linkedin to build a full contact profile.\n4. Score the lead by company fit and route high-intent matches to sales.\n\n## Output\nReturn the resolved company, person name, title, and LinkedIn. Flag whether the match clears your fit threshold.',
    },
    {
      name: 'enrich-linkedin-contact',
      description: 'Enrich a LinkedIn profile with business email and phone for outreach.',
      content:
        '# Enrich LinkedIn Contact\n\nTurn a LinkedIn profile into reachable contact details.\n\n## Steps\n1. Provide the LinkedIn URL or slug; use linkedin_slug_search first if you only have a name.\n2. Run linkedin_to_business_profile to capture role and company.\n3. Run linkedin_to_best_personal_email and linkedin_to_mobile_phone for direct contact points.\n4. Push the enriched record into the CRM or an outreach sequence.\n\n## Output\nReturn the contact name, company, best email, and phone. Note any field that could not be resolved.',
    },
    {
      name: 'check-credit-balance',
      description: 'Check the RB2B credit balance before running a batch of enrichment lookups.',
      content:
        '# Check Credit Balance\n\nVerify enrichment credits remain before a batch run.\n\n## Steps\n1. Run credit_check to read the current balance.\n2. Estimate the credits needed for the planned lookups.\n3. If the balance is insufficient, alert the team rather than starting a partial run.\n\n## Output\nReturn the remaining credit balance and whether the planned batch can proceed.',
    },
  ],
} as const satisfies BlockMeta
