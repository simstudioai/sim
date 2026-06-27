import { EnrichSoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const EnrichBlockDisplay = {
  type: 'enrich',
  name: 'Enrich',
  description: 'B2B data enrichment and LinkedIn intelligence with Enrich.so',
  category: 'tools',
  bgColor: '#E5E5E6',
  icon: EnrichSoIcon,
  longDescription:
    'Access real-time B2B data intelligence with Enrich.so. Enrich profiles from email addresses, find work emails from LinkedIn, verify email deliverability, search for people and companies, and analyze LinkedIn post engagement.',
  docsLink: 'https://docs.enrich.so/',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const EnrichBlockMeta = {
  tags: ['enrichment'],
  url: 'https://www.enrich.so',
  templates: [
    {
      icon: EnrichSoIcon,
      title: 'Enrich CRM hydrator',
      prompt:
        'Build a workflow that watches new Salesforce leads, enriches each with Enrich.so contact data, and writes role, company size, and email to the lead record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich list cleaner',
      prompt:
        'Create a workflow that runs an outreach list through Enrich, removes invalid emails and disqualified roles, and writes the clean list to a sender table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich bulk-account researcher',
      prompt:
        'Build a workflow that takes a list of target accounts, enriches each with Enrich firmographic data, and writes a tables-based account brief for the sales team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich + Email Bison sender',
      prompt:
        'Create a workflow that runs Enrich on prospects then drafts and sends a personalized Email Bison sequence based on the enriched fields.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich event-attendee researcher',
      prompt:
        'Build a workflow that takes the Luma event attendee list, enriches each via Enrich, and writes a per-attendee research brief for the sales team.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['luma'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich CRM gap-filler',
      prompt:
        'Create a scheduled workflow that finds HubSpot contacts missing key fields, runs Enrich, and fills in the gaps so reporting is complete.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EnrichSoIcon,
      title: 'Enrich LinkedIn role validator',
      prompt:
        'Build a scheduled workflow that reads HubSpot contacts with a LinkedIn profile URL, re-enriches each with Enrich, flags outdated roles, and updates the contact record with the current title.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'enrich-contact-from-email',
      description:
        'Enrich a person from their email address — name, role, company, social profiles, and more.',
      content:
        '# Enrich Contact from Email\n\nTurn an email address into a full contact profile using Enrich.so.\n\n## Steps\n1. Take the email address. Choose Email to Profile for a full enrichment, or Email to Person (Lite) for a fast, cheaper lookup.\n2. Enable fresh-data fetch when up-to-date info matters more than speed.\n3. Read back name, current title, company, location, and any LinkedIn or social URLs.\n\n## Output\nReturn the enriched fields in a clean object. Note which fields could not be resolved so downstream steps know what is missing, and report remaining credits if relevant.',
    },
    {
      name: 'find-and-verify-work-email',
      description:
        'Find a prospect work email from a name and company or LinkedIn URL, then verify deliverability.',
      content:
        '# Find and Verify Work Email\n\nLocate a reliable work email for a prospect and confirm it is safe to send to.\n\n## Steps\n1. If you have a name and company domain, use Find Email. If you have a LinkedIn profile URL, use LinkedIn to Work Email instead.\n2. Run Verify Email on the returned address to check deliverability, and Disposable Email Check to rule out throwaway domains.\n3. If the work email cannot be found, optionally fall back to LinkedIn to Personal Email when appropriate.\n\n## Output\nReturn the discovered email, its verification status (valid, risky, invalid), and whether it is disposable. Recommend whether the address is safe to add to outreach.',
    },
    {
      name: 'enrich-company-firmographics',
      description:
        'Look up firmographic data for a company — size, industry, funding, revenue, and traffic.',
      content:
        '# Enrich Company Firmographics\n\nBuild a firmographic profile for a target account using Enrich.so.\n\n## Steps\n1. Identify the company by name or domain. Use Company Lookup for core firmographics.\n2. Add Company Funding & Traffic and Company Revenue for deeper financial signals when account scoring needs them.\n3. If you only have a visitor IP, use IP to Company first to resolve the organization.\n\n## Output\nReturn a consolidated account brief: company name, domain, industry, employee count, funding, revenue, and traffic. Flag any data points that could not be resolved.',
    },
    {
      name: 'search-prospects',
      description:
        'Search Enrich.so for people or companies matching an ideal-customer-profile filter.',
      content:
        '# Search Prospects\n\nFind people or companies that match a target profile.\n\n## Steps\n1. For people, use Search People with filters like job title, industry, location, and skills. For companies, use Search Company with industry, location, and employee-size bounds.\n2. To pull contacts at known accounts, use Search Company Employees with the company IDs and target job titles.\n3. Page through results using the page and page-size parameters until you have enough matches.\n\n## Output\nReturn the matching people or companies with their key identifying fields and any profile URLs, plus a count of total matches. Suggest tighter filters if too many or too few results come back.',
    },
  ],
} as const satisfies BlockMeta
