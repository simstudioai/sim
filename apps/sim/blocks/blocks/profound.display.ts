import { ProfoundIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ProfoundBlockDisplay = {
  type: 'profound',
  name: 'Profound',
  description: 'AI visibility and analytics with Profound',
  category: 'tools',
  bgColor: '#000000',
  icon: ProfoundIcon,
  longDescription:
    'Track how your brand appears across AI platforms. Monitor visibility scores, sentiment, citations, bot traffic, referrals, content optimization, and prompt volumes with Profound.',
  docsLink: 'https://docs.sim.ai/integrations/profound',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const ProfoundBlockMeta = {
  tags: ['seo', 'data-analytics'],
  url: 'https://www.tryprofound.com',
  templates: [
    {
      icon: ProfoundIcon,
      title: 'Profound AI-visibility tracker',
      prompt:
        'Create a scheduled weekly workflow that pulls Profound brand-visibility scores across AI search engines, tracks how my brand surfaces in answers for tracked prompts, and reports week-over-week shifts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound competitor share-of-voice',
      prompt:
        'Build a workflow that pulls Profound competitor share-of-voice across AI engines, writes the leaderboard to a tracking table, and flags when a competitor jumps more than two positions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound prompt-coverage audit',
      prompt:
        "Build a scheduled weekly workflow that reads Profound's tracked-prompt coverage and prompt answers to monitor how my brand surfaces in AI answers across engines, and writes the coverage scorecard to a tables-based report.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound citation-source tracker',
      prompt:
        'Build a scheduled workflow that pulls the sources Profound reports AI engines cite when answering brand prompts, logs the citing domains and pages to a table, and flags new sources the content team should target.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'analysis'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound visibility-drop alerter',
      prompt:
        'Create a workflow that checks Profound brand-visibility scores daily, compares each tracked prompt against its baseline, and immediately pages the marketing on-call in Slack when visibility drops sharply on a high-priority prompt.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound content-gap planner',
      prompt:
        'Build a workflow that pulls the prompts where Profound shows my brand is absent from AI answers, has an agent draft a prioritized content brief for each gap, and creates the briefs as Notion pages for the content team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound executive AI-search digest',
      prompt:
        'Create a scheduled monthly workflow that aggregates Profound visibility, share-of-voice, and citation trends into a Markdown report file with commentary, and emails the AI-search performance digest to leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'check-brand-visibility',
      description:
        'Pull a Profound visibility report to see how a brand surfaces in AI answers for tracked prompts.',
      content:
        '# Check Brand Visibility\n\nMeasure how often a brand appears in AI engine answers.\n\n## Steps\n1. Use the Visibility Report operation with the Category ID and a Start Date and End Date.\n2. Set Metrics such as share_of_voice, visibility_score, and mentions_count.\n3. Optionally break the data out by Dimensions (date, model) and set a Date Interval.\n4. Compare the latest period against the prior one.\n\n## Output\nThe visibility and share-of-voice scores for the period, broken down by model where requested, with the change versus the previous window.',
    },
    {
      name: 'track-citation-sources',
      description:
        'Pull a Profound citations report to see which sources AI engines cite for brand prompts.',
      content:
        '# Track Citation Sources\n\nFind the sources AI engines cite when answering about a brand.\n\n## Steps\n1. Use the Citations Report operation with the Category ID, Start Date, and End Date, and set Metrics such as count and citation_share.\n2. For a specific domain, use Citation Prompts with the Domain to see which prompts cite it.\n3. Optionally add Dimensions to group by source domain or page.\n\n## Output\nA ranked list of citing domains and pages with their citation share, highlighting any new sources the content team should target.',
    },
    {
      name: 'compare-competitor-share',
      description:
        'Use Profound visibility metrics to compare a brand against competitors in AI answers.',
      content:
        '# Compare Competitor Share\n\nBenchmark share-of-voice across competitors.\n\n## Steps\n1. Use the Visibility Report operation for the Category ID over a date window with the share_of_voice metric.\n2. Add Dimensions to break results out by asset or brand name, and apply Filters as JSON to scope to the competitor set.\n3. Rank the brands by share-of-voice.\n\n## Output\nA leaderboard of brands by share-of-voice in AI answers, flagging any competitor that gained or lost notable ground.',
    },
    {
      name: 'find-content-gaps',
      description:
        'Use Profound prompt and answer data to find prompts where the brand is absent from AI answers.',
      content:
        '# Find Content Gaps\n\nSurface prompts where the brand is missing from AI answers.\n\n## Steps\n1. Use Category Prompts with the Category ID to list tracked prompts, paging with the cursor.\n2. Use Prompt Answers over a date window to see how the brand appears (or does not) for each prompt.\n3. Flag prompts with low or zero visibility as content gaps.\n\n## Output\nA prioritized list of prompts where the brand is absent or weak in AI answers, ready to drive content briefs.',
    },
  ],
} as const satisfies BlockMeta
