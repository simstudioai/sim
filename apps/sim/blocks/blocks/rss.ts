import { RssIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const RssBlock: BlockConfig = {
  type: 'rss',
  name: 'RSS Feed',
  description: 'Monitor RSS feeds and trigger workflows when new items are published',
  longDescription:
    'Subscribe to any RSS or Atom feed and automatically trigger your workflow when new content is published. Perfect for monitoring blogs, news sites, podcasts, and any content that publishes an RSS feed.',
  category: 'triggers',
  bgColor: '#F97316',
  icon: RssIcon,
  triggerAllowed: true,
  docsLink: 'https://docs.sim.ai/triggers/rss',

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
