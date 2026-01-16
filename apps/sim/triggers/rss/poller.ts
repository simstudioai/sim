import { RssIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const rssPollingTrigger: TriggerConfig = {
  id: 'rss_poller',
  name: 'RSS Feed Trigger',
  provider: 'rss',
  description: 'Triggers when new items are published to an RSS feed',
  version: '1.0.0',
  icon: RssIcon,

  subBlocks: [
    {
      id: 'feedUrl',
      title: 'Feed URL',
      type: 'short-input',
      placeholder: 'https://example.com/feed.xml',
      description: 'The URL of the RSS or Atom feed to monitor',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'rss_poller',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Enter the URL of any RSS or Atom feed you want to monitor',
        'The feed will be checked every minute for new items',
        'When a new item is published, your workflow will be triggered with the item data',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    item: {
      title: {
        type: 'string',
        description: 'Item title',
      },
      link: {
        type: 'string',
        description: 'Item link/URL',
      },
      pubDate: {
        type: 'string',
        description: 'Publication date',
      },
      guid: {
        type: 'string',
        description: 'Unique identifier',
      },
      summary: {
        type: 'string',
        description: 'Item description/summary',
      },
      content: {
        type: 'string',
        description: 'Full content (content:encoded)',
      },
      contentSnippet: {
        type: 'string',
        description: 'Content snippet without HTML',
      },
      author: {
        type: 'string',
        description: 'Author name',
      },
      categories: {
        type: 'json',
        description: 'Categories/tags array',
      },
      enclosure: {
        type: 'json',
        description: 'Media attachment info (url, type, length)',
      },
      isoDate: {
        type: 'string',
        description: 'Publication date in ISO format',
      },
    },
    feed: {
      title: {
        type: 'string',
        description: 'Feed title',
      },
      link: {
        type: 'string',
        description: 'Feed website link',
      },
      feedDescription: {
        type: 'string',
        description: 'Feed description',
      },
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
    },
  },
}
