import type { OutputProperty } from '@/tools/types'

export const PROMPT_OUT_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  text: { type: 'string', description: 'Text' },
  topicId: { type: 'string', description: 'Topic id', nullable: true },
  trackingType: { type: 'string', description: 'Tracking type' },
  tagIds: { type: 'array', items: { type: 'string' }, description: 'Tag ids' },
  createdAt: { type: 'string', description: 'Created at' },
  firstAnswerDay: { type: 'string', description: 'First answer day', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const CATEGORY_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  slug: { type: 'string', description: 'Slug' },
  name: { type: 'string', description: 'Name' },
  description: { type: 'string', description: 'Description' },
} as const satisfies Record<string, OutputProperty>

const ORGANIZATION_PRODUCTS_PROPERTIES = {
  chat: { type: 'boolean', description: 'Chat' },
  agents: { type: 'boolean', description: 'Agents', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const FRESHNESS_OUT_PROPERTIES = {
  watermark: { type: 'string', description: 'Watermark', nullable: true },
  pending: { type: 'number', description: 'Pending' },
  available: { type: 'boolean', description: 'Available' },
} as const satisfies Record<string, OutputProperty>

export const DIRECTORY_ORGANIZATION_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  slug: { type: 'string', description: 'Slug' },
  name: { type: 'string', description: 'Name' },
  products: { type: 'json', properties: ORGANIZATION_PRODUCTS_PROPERTIES, description: 'Products' },
} as const satisfies Record<string, OutputProperty>

const MENTION_PROPERTIES = {
  brandId: { type: 'string', description: 'Brand id' },
  name: { type: 'string', description: 'Name' },
  mentionTypes: { type: 'array', items: { type: 'string' }, description: 'Mention types' },
  count: { type: 'number', description: 'Count' },
} as const satisfies Record<string, OutputProperty>

const ORGANIZATION_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  slug: { type: 'string', description: 'Slug' },
  name: { type: 'string', description: 'Name' },
} as const satisfies Record<string, OutputProperty>

export const API_KEY_INFO_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  name: { type: 'string', description: 'Name' },
  prefix: { type: 'string', description: 'Prefix' },
  organization: { type: 'json', properties: ORGANIZATION_PROPERTIES, description: 'Organization' },
} as const satisfies Record<string, OutputProperty>

export const COLUMN_PROPERTIES = {
  key: { type: 'string', description: 'Key' },
  kind: { type: 'string', description: 'Kind' },
  type: { type: 'string', description: 'Type' },
  unit: { type: 'string', description: 'Unit', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

export const ANSWER_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  promptId: { type: 'string', description: 'Prompt id' },
  topicId: { type: 'string', description: 'Topic id', nullable: true },
  model: { type: 'string', description: 'Model' },
  day: { type: 'string', description: 'Day' },
  createdAt: { type: 'string', description: 'Created at' },
  text: { type: 'string', description: 'Text' },
  brandIds: { type: 'array', items: { type: 'string' }, description: 'Brand ids' },
} as const satisfies Record<string, OutputProperty>

const CITED_PAGE_PROPERTIES = {
  pageId: { type: 'string', description: 'Page id' },
  url: { type: 'string', description: 'Url' },
  title: { type: 'string', description: 'Title', nullable: true },
  domain: { type: 'string', description: 'Domain' },
} as const satisfies Record<string, OutputProperty>

export const ANSWER_DETAIL_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  promptId: { type: 'string', description: 'Prompt id' },
  promptText: { type: 'string', description: 'Prompt text' },
  topicId: { type: 'string', description: 'Topic id', nullable: true },
  model: { type: 'string', description: 'Model' },
  day: { type: 'string', description: 'Day' },
  createdAt: { type: 'string', description: 'Created at' },
  text: { type: 'string', description: 'Text' },
  mentions: {
    type: 'array',
    items: { type: 'object', properties: MENTION_PROPERTIES },
    description: 'Mentions',
  },
  citations: {
    type: 'array',
    items: { type: 'object', properties: CITED_PAGE_PROPERTIES },
    description: 'Citations',
  },
  searchQueries: { type: 'array', items: { type: 'string' }, description: 'Search queries' },
} as const satisfies Record<string, OutputProperty>

export const CITATION_ITEM_PROPERTIES = {
  answerId: { type: 'string', description: 'Answer id' },
  pageId: { type: 'string', description: 'Page id' },
  promptId: { type: 'string', description: 'Prompt id' },
  model: { type: 'string', description: 'Model' },
  day: { type: 'string', description: 'Day' },
  domain: { type: 'string', description: 'Domain' },
  url: { type: 'string', description: 'Url' },
} as const satisfies Record<string, OutputProperty>

export const TAG_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  name: { type: 'string', description: 'Name' },
  color: { type: 'string', description: 'Color' },
  promptCount: { type: 'number', description: 'Prompt count' },
} as const satisfies Record<string, OutputProperty>

export const CREATE_RESULT_PROPERTIES = {
  index: { type: 'number', description: 'Index' },
  status: { type: 'string', description: 'Status' },
  prompt: {
    type: 'json',
    properties: PROMPT_OUT_PROPERTIES,
    description: 'Prompt',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const TOKEN_INFO_PROPERTIES = {
  kind: { type: 'string', description: 'Kind' },
  scopes: { type: 'array', items: { type: 'string' }, description: 'Scopes' },
  expiresAt: { type: 'string', description: 'Expires at', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const DATE_RANGE_OUT_PROPERTIES = {
  since: { type: 'string', description: 'Since' },
  until: { type: 'string', description: 'Until' },
} as const satisfies Record<string, OutputProperty>

export const BRAND_OUT_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  name: { type: 'string', description: 'Name' },
  slug: { type: 'string', description: 'Slug' },
  website: { type: 'string', description: 'Website' },
  role: { type: 'string', description: 'Role' },
} as const satisfies Record<string, OutputProperty>

export const USER_INFO_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  email: { type: 'string', description: 'Email' },
  name: { type: 'string', description: 'Name' },
} as const satisfies Record<string, OutputProperty>

export const TOPIC_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  slug: { type: 'string', description: 'Slug' },
  title: { type: 'string', description: 'Title' },
  promptCount: { type: 'number', description: 'Prompt count' },
  createdAt: { type: 'string', description: 'Created at' },
} as const satisfies Record<string, OutputProperty>
