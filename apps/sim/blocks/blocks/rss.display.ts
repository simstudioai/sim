import { BookOpen, Table } from '@/components/emcn/icons'
import { RssIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RssBlockDisplay = {
  type: 'rss',
  name: 'RSS Feed',
  description: 'Monitor RSS feeds and trigger workflows when new items are published',
  category: 'triggers',
  bgColor: '#F97316',
  icon: RssIcon,
  longDescription:
    'Subscribe to any RSS or Atom feed and automatically trigger your workflow when new content is published. Perfect for monitoring blogs, news sites, podcasts, and any content that publishes an RSS feed.',
  docsLink: 'https://docs.sim.ai/workflows/triggers/rss',
  integrationType: IntegrationType.Search,
  triggerAllowed: true,
} satisfies BlockDisplay

export const RssBlockMeta = {
  tags: ['automation', 'content-management'],
  templates: [
    {
      icon: RssIcon,
      title: 'RSS post to Slack',
      prompt:
        'Build a workflow that triggers when a new item is published in an RSS feed, writes a one-line summary of the item with an agent, and posts the title, summary, and link to a Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Table,
      title: 'RSS feed to content table',
      prompt:
        'Create a workflow that triggers on each new RSS feed item, extracts the title, link, and publish date, tags the topic with an agent, and appends a row to a content tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
    },
    {
      icon: BookOpen,
      title: 'Competitor blog watcher',
      prompt:
        'Build a workflow that triggers when a competitor publishes a new RSS item, summarizes the post and flags anything relevant to our roadmap with an agent, and emails the brief to the team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
