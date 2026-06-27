import { RssIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

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
