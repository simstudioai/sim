import { SimilarwebIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SimilarwebBlockDisplay = {
  type: 'similarweb',
  name: 'Similarweb',
  description: 'Website traffic and analytics data',
  category: 'tools',
  bgColor: '#000922',
  icon: SimilarwebIcon,
  longDescription:
    'Access comprehensive website analytics including traffic estimates, engagement metrics, rankings, and traffic sources using the Similarweb API.',
  docsLink: 'https://developers.similarweb.com/docs/similarweb-web-traffic-api',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const SimilarwebBlockMeta = {
  tags: ['marketing', 'data-analytics', 'seo'],
  url: 'https://www.similarweb.com',
  templates: [
    {
      icon: SimilarwebIcon,
      title: 'Similarweb traffic intelligence',
      prompt:
        'Build a scheduled workflow that pulls Similarweb traffic data for tracked competitor domains monthly, writes traffic, sources, and engagement to a tables-based scoreboard, and flags step changes in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb account intel sync',
      prompt:
        'Create a workflow that watches my CRM for new accounts, pulls Similarweb data on each account domain, writes traffic estimates, rankings, and engagement signals back to the account record for sales context.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb category benchmarking',
      prompt:
        'Create a scheduled workflow that pulls Similarweb category rank, visit duration, and bounce rate for my domain and a set of tracked competitors, then writes a ranked benchmarking table for the marketing review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb funnel-source analyzer',
      prompt:
        'Build a scheduled workflow that pulls Similarweb traffic-source data for my domain and competitors, surfaces shifting acquisition channels, and writes the analysis to a marketing table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb traffic-source overlap finder',
      prompt:
        'Create a scheduled workflow that pulls Similarweb traffic-source breakdowns for my domain and tracked competitors, identifies channels where competitors over-index, and writes an acquisition opportunity table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb engagement scorecard',
      prompt:
        'Build a scheduled workflow that pulls Similarweb bounce rate, pages per visit, and average visit duration for my domain and key competitors, writes the engagement metrics to a table, and posts a Slack scorecard highlighting where my site under- or over-performs the set.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb prospect prioritizer',
      prompt:
        "Create a workflow that reads a list of target company domains from a table, pulls each domain's Similarweb website overview and monthly visits, scores them by traffic size and growth, and writes a prioritized outbound list for the sales team.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'profile-website-traffic',
      description:
        'Pull a Similarweb website overview and traffic metrics for a domain and summarize its scale.',
      content:
        '# Profile Website Traffic\n\nBuild a quick traffic profile for a single domain.\n\n## Steps\n1. Run Website Overview for the domain to get a high-level snapshot.\n2. Run Traffic Visits, Bounce Rate, Pages Per Visit, and Visit Duration for deeper engagement metrics, setting the country (or worldwide) to scope the data.\n3. Interpret the numbers together: high visits with a low bounce rate and long duration indicates strong engagement.\n\n## Output\nReturn a concise profile of the domain: estimated monthly visits, bounce rate, pages per visit, and average visit duration, with a one-line read on overall traffic health.',
    },
    {
      name: 'compare-competitor-domains',
      description:
        'Pull Similarweb traffic metrics for several domains and rank them for a competitive view.',
      content:
        '# Compare Competitor Domains\n\nBenchmark a set of competing domains on traffic and engagement.\n\n## Steps\n1. For each domain, run Website Overview and Traffic Visits using the same country scope so the numbers are comparable.\n2. Optionally add Bounce Rate and Pages Per Visit for an engagement dimension.\n3. Rank the domains by visits and engagement.\n\n## Output\nReturn a ranked table of the domains with their visits, bounce rate, and engagement metrics, and a short read on which competitor leads.',
    },
    {
      name: 'score-prospect-domains',
      description:
        'Score a list of prospect domains by Similarweb traffic size to prioritize outreach.',
      content:
        '# Score Prospect Domains\n\nPrioritize sales prospects by the size of their web traffic.\n\n## Steps\n1. For each prospect domain, run Website Overview and Traffic Visits in the relevant region.\n2. Assign a score based on monthly visits and any visible growth trend.\n3. Sort the prospects from highest to lowest score.\n\n## Output\nReturn the prospect domains ranked by score, each with its estimated monthly visits, so the sales team can prioritize the biggest-traffic targets.',
    },
  ],
} as const satisfies BlockMeta
