import { AhrefsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AhrefsBlockDisplay = {
  type: 'ahrefs',
  name: 'Ahrefs',
  description: 'SEO analysis with Ahrefs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AhrefsIcon,
  longDescription:
    'Integrate Ahrefs SEO tools into your workflow. Analyze domain ratings, backlinks, organic keywords, top pages, and more. Requires an Ahrefs Enterprise plan with API access.',
  docsLink: 'https://docs.ahrefs.com/docs/api/reference/introduction',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const AhrefsBlockMeta = {
  tags: ['seo', 'marketing', 'data-analytics'],
  url: 'https://ahrefs.com',
  templates: [
    {
      icon: AhrefsIcon,
      title: 'Ahrefs keyword tracker',
      prompt:
        'Create a scheduled weekly workflow that queries Ahrefs for ranking positions of my tracked keywords, logs the results into a tables-based SEO scorecard, and posts a Slack summary of gainers and losers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs competitor backlink monitor',
      prompt:
        'Build a scheduled workflow that pulls new Ahrefs referring domains for my competitors weekly, flags high-authority links, and posts a Slack digest with the linking page and anchor text.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs content gap finder',
      prompt:
        'Create a workflow that pulls Ahrefs organic keywords for both my domain and a competitor, has an agent diff the lists to find keywords the competitor ranks for that I do not, and writes a prioritized content brief table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs broken-link sweeper',
      prompt:
        'Build a scheduled workflow that runs an Ahrefs broken-backlinks check weekly, writes broken referring pages to a remediation table, and proposes redirects for the SEO lead to approve.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs + Similarweb growth scoreboard',
      prompt:
        'Build a scheduled monthly workflow that joins Ahrefs SEO data with Similarweb traffic intelligence, writes a growth scoreboard table, and emails leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['similarweb', 'gmail'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs + Profound combined visibility',
      prompt:
        'Create a scheduled weekly workflow that combines Ahrefs SEO rankings with Profound AI-visibility scores, writes a combined visibility report, and surfaces gaps to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['profound', 'slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs domain-health watchdog',
      prompt:
        'Build a scheduled workflow that checks Ahrefs domain rating and backlink stats for my site daily, logs the values to a trend table, and posts a Slack alert when domain rating drops or a spike of lost referring domains is detected.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'analyze-competitor-backlinks',
      description:
        "Pull a competitor domain's backlink profile from Ahrefs and surface link-building opportunities.",
      content:
        "# Analyze Competitor Backlinks\n\nUse Ahrefs to study a competitor's backlinks and find outreach targets.\n\n## Steps\n1. Run a backlink/referring-domains report for the competitor URL or domain.\n2. Identify high-authority referring domains and the anchor texts they use.\n3. Compare against your own domain to find sites linking to them but not you.\n\n## Output\nA prioritized list of link opportunities: referring domain, authority, linked page, and why it is worth pursuing.",
    },
    {
      name: 'keyword-research-report',
      description:
        'Research keywords in Ahrefs for a topic and report volume, difficulty, and ranking opportunities.',
      content:
        '# Keyword Research Report\n\nBuild a keyword opportunity report from Ahrefs data.\n\n## Steps\n1. Pull the organic keywords a competitor domain already ranks for to source candidate keywords for the topic.\n2. Run a keyword overview on the most relevant candidates to collect search volume and keyword difficulty.\n3. Highlight keywords with meaningful volume and lower difficulty as quick wins.\n\n## Output\nA table of keywords with volume and difficulty, grouped into quick wins vs long-term targets, with a short recommendation.',
    },
    {
      name: 'track-organic-rankings',
      description:
        "Pull a domain's organic keyword rankings from Ahrefs and report top movers and lost positions.",
      content:
        '# Track Organic Rankings\n\nReport how a domain is ranking in organic search using Ahrefs.\n\n## Steps\n1. Pull the organic keywords report for the target domain.\n2. Identify the top-ranking keywords and their positions.\n3. Compare against a prior snapshot if available to find gains and losses.\n\n## Output\nA summary of top organic keywords, notable position gains and drops, and pages that may need attention.',
    },
  ],
} as const satisfies BlockMeta
