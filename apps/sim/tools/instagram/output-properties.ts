import type { OutputProperty } from '@/tools/types'

export const INSTAGRAM_MEDIA_PROPERTIES = {
  id: { type: 'string', description: 'Instagram media ID' },
  caption: { type: 'string', description: 'Caption text', nullable: true },
  mediaType: { type: 'string', description: 'IMAGE, VIDEO, or CAROUSEL_ALBUM', nullable: true },
  mediaProductType: {
    type: 'string',
    description: 'Feed, Reels, or Stories product type',
    nullable: true,
  },
  mediaUrl: {
    type: 'string',
    description: 'Temporary Instagram CDN URL',
    nullable: true,
  },
  permalink: { type: 'string', description: 'Permalink to the media', nullable: true },
  timestamp: { type: 'string', description: 'ISO timestamp', nullable: true },
  likeCount: { type: 'number', description: 'Like count', nullable: true },
  commentsCount: { type: 'number', description: 'Comment count', nullable: true },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_STORY_PROPERTIES = {
  id: { type: 'string', description: 'Instagram story ID' },
  mediaType: { type: 'string', description: 'IMAGE or VIDEO', nullable: true },
  mediaUrl: {
    type: 'string',
    description: 'Temporary Instagram CDN URL',
    nullable: true,
  },
  timestamp: { type: 'string', description: 'ISO timestamp', nullable: true },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_COMMENT_PROPERTIES = {
  id: { type: 'string', description: 'Instagram comment ID' },
  text: { type: 'string', description: 'Comment text', nullable: true },
  username: { type: 'string', description: 'Comment author username', nullable: true },
  timestamp: { type: 'string', description: 'ISO timestamp', nullable: true },
  likeCount: { type: 'number', description: 'Like count', nullable: true },
  hidden: { type: 'boolean', description: 'Whether the comment is hidden', nullable: true },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_CONVERSATION_PROPERTIES = {
  id: { type: 'string', description: 'Instagram conversation ID' },
  updatedTime: { type: 'string', description: 'Last updated timestamp', nullable: true },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_MESSAGE_REFERENCE_PROPERTIES = {
  id: { type: 'string', description: 'Instagram message ID' },
  createdTime: { type: 'string', description: 'Created timestamp', nullable: true },
  isUnsupported: {
    type: 'boolean',
    description: 'Whether this message type is unsupported by the API',
  },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_INSIGHT_PROPERTIES = {
  name: { type: 'string', description: 'Metric name', nullable: true },
  period: { type: 'string', description: 'Aggregation period', nullable: true },
  title: { type: 'string', description: 'Human-readable metric title', nullable: true },
  description: { type: 'string', description: 'Metric description', nullable: true },
  values: {
    type: 'json',
    description: 'Metric values; shape varies by metric and requested breakdown',
  },
  totalValue: {
    type: 'json',
    description: 'Aggregate metric value; shape varies by metric and breakdown',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const INSTAGRAM_CHILD_MEDIA_PROPERTIES = {
  id: { type: 'string', description: 'Carousel child media ID' },
} satisfies Record<string, OutputProperty>
