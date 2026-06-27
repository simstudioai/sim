import { BookOpen, Table } from '@/components/emcn/icons'
import { RssIcon } from '@/components/icons'
import { RssBlockDisplay } from '@/blocks/blocks/rss.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const RssBlock: BlockConfig = {
  ...RssBlockDisplay,
  subBlocks: [...getTrigger('rss_poller').subBlocks],

  tools: {
    access: [], // Trigger-only for now
  },

  inputs: {},

  outputs: {
    title: { type: 'string', description: 'Item title' },
    link: { type: 'string', description: 'Item link' },
    pubDate: { type: 'string', description: 'Publication date' },
    item: { type: 'json', description: 'Raw item object with all fields' },
    feed: { type: 'json', description: 'Raw feed object with all fields' },
  },

  triggers: {
    enabled: true,
    available: ['rss_poller'],
  },
}

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
