import { RssBlockDisplay } from '@/blocks/blocks/rss.display'
import type { BlockConfig } from '@/blocks/types'
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
