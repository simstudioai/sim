import { z } from 'zod'
import type { ToolOutputProperty } from '@/tools/types'

export const reactionSchema = z
  .object({ name: z.string(), count: z.number(), users: z.array(z.string()) })
  .passthrough()
export const reactionOutput = {
  type: 'object',
  description: 'Reaction',
  properties: {
    name: { type: 'string', description: 'Name' },
    count: { type: 'number', description: 'Count' },
    users: {
      type: 'array',
      description: 'Users',
      items: { type: 'string', description: 'Users item' },
    },
  },
} satisfies ToolOutputProperty

export const profileSchema = z
  .object({
    title: z.string().optional(),
    phone: z.string().optional(),
    real_name: z.string().optional(),
    display_name: z.string().optional(),
    email: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    status_text: z.string().optional(),
    status_emoji: z.string().optional(),
    image_48: z.string().optional(),
    image_192: z.string().optional(),
    image_512: z.string().optional(),
    pronouns: z.string().optional(),
    start_date: z.string().optional(),
    status_expiration: z.number().optional(),
    fields: z
      .record(
        z.string(),
        z.object({ value: z.string().optional(), alt: z.string().optional() }).passthrough()
      )
      .nullable()
      .optional(),
  })
  .passthrough()
export const profileOutput = {
  type: 'object',
  description: 'Profile',
  properties: {
    title: { type: 'string', description: 'Title', optional: true },
    phone: { type: 'string', description: 'Phone', optional: true },
    real_name: { type: 'string', description: 'Real name', optional: true },
    display_name: { type: 'string', description: 'Display name', optional: true },
    email: { type: 'string', description: 'Email', optional: true },
    first_name: { type: 'string', description: 'First name', optional: true },
    last_name: { type: 'string', description: 'Last name', optional: true },
    status_text: { type: 'string', description: 'Status text', optional: true },
    status_emoji: { type: 'string', description: 'Status emoji', optional: true },
    image_48: { type: 'string', description: 'Image 48', optional: true },
    image_192: { type: 'string', description: 'Image 192', optional: true },
    image_512: { type: 'string', description: 'Image 512', optional: true },
    pronouns: { type: 'string', description: 'Pronouns', optional: true },
    start_date: { type: 'string', description: 'Start date', optional: true },
    status_expiration: { type: 'number', description: 'Status expiration', optional: true },
    fields: { type: 'json', description: 'Fields', optional: true, nullable: true },
  },
} satisfies ToolOutputProperty

export const conversationSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    creator: z.string().optional(),
    user: z.string().optional(),
    last_read: z.string().optional(),
    is_archived: z.boolean().optional(),
    is_private: z.boolean().optional(),
    is_im: z.boolean().optional(),
    is_mpim: z.boolean().optional(),
    is_member: z.boolean().optional(),
    is_open: z.boolean().optional(),
    created: z.number().optional(),
    topic: z
      .object({
        value: z.string(),
        creator: z.string().optional(),
        last_set: z.number().optional(),
      })
      .passthrough()
      .optional(),
    purpose: z
      .object({
        value: z.string(),
        creator: z.string().optional(),
        last_set: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export const conversationOutput = {
  type: 'object',
  description: 'Conversation',
  properties: {
    id: { type: 'string', description: 'Id' },
    name: { type: 'string', description: 'Name', optional: true },
    creator: { type: 'string', description: 'Creator', optional: true },
    user: { type: 'string', description: 'User', optional: true },
    last_read: { type: 'string', description: 'Last read', optional: true },
    is_archived: { type: 'boolean', description: 'Is archived', optional: true },
    is_private: { type: 'boolean', description: 'Is private', optional: true },
    is_im: { type: 'boolean', description: 'Is im', optional: true },
    is_mpim: { type: 'boolean', description: 'Is mpim', optional: true },
    is_member: { type: 'boolean', description: 'Is member', optional: true },
    is_open: { type: 'boolean', description: 'Is open', optional: true },
    created: { type: 'number', description: 'Created', optional: true },
    topic: {
      type: 'object',
      description: 'Topic',
      optional: true,
      properties: {
        value: { type: 'string', description: 'Value' },
        creator: { type: 'string', description: 'Creator', optional: true },
        last_set: { type: 'number', description: 'Last set', optional: true },
      },
    },
    purpose: {
      type: 'object',
      description: 'Purpose',
      optional: true,
      properties: {
        value: { type: 'string', description: 'Value' },
        creator: { type: 'string', description: 'Creator', optional: true },
        last_set: { type: 'number', description: 'Last set', optional: true },
      },
    },
  },
} satisfies ToolOutputProperty

export const userSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    real_name: z.string().optional(),
    team_id: z.string().optional(),
    deleted: z.boolean().optional(),
    is_bot: z.boolean().optional(),
    profile: profileSchema.optional(),
  })
  .passthrough()
export const userOutput = {
  type: 'object',
  description: 'User',
  properties: {
    id: { type: 'string', description: 'Id' },
    name: { type: 'string', description: 'Name', optional: true },
    real_name: { type: 'string', description: 'Real name', optional: true },
    team_id: { type: 'string', description: 'Team id', optional: true },
    deleted: { type: 'boolean', description: 'Deleted', optional: true },
    is_bot: { type: 'boolean', description: 'Is bot', optional: true },
    profile: { ...profileOutput, optional: true },
  },
} satisfies ToolOutputProperty

export const fileSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    mimetype: z.string().optional(),
    filetype: z.string().optional(),
    user: z.string().optional(),
    mode: z.string().optional(),
    permalink: z.string().optional(),
    url_private: z.string().optional(),
    url_private_download: z.string().optional(),
    size: z.number().optional(),
    created: z.number().optional(),
    is_public: z.boolean().optional(),
    reactions: z.array(reactionSchema).optional(),
  })
  .passthrough()
export const fileOutput = {
  type: 'object',
  description: 'File',
  properties: {
    id: { type: 'string', description: 'Id', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    title: { type: 'string', description: 'Title', optional: true },
    mimetype: { type: 'string', description: 'Mimetype', optional: true },
    filetype: { type: 'string', description: 'Filetype', optional: true },
    user: { type: 'string', description: 'User', optional: true },
    mode: { type: 'string', description: 'Mode', optional: true },
    permalink: { type: 'string', description: 'Permalink', optional: true },
    url_private: { type: 'string', description: 'Url private', optional: true },
    url_private_download: { type: 'string', description: 'Url private download', optional: true },
    size: { type: 'number', description: 'Size', optional: true },
    created: { type: 'number', description: 'Created', optional: true },
    is_public: { type: 'boolean', description: 'Is public', optional: true },
    reactions: {
      type: 'array',
      description: 'Reactions',
      optional: true,
      items: { ...reactionOutput },
    },
  },
} satisfies ToolOutputProperty

export const messageSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
    user: z.string().optional(),
    ts: z.string(),
    permalink: z.string().optional(),
    reactions: z.array(reactionSchema).optional(),
  })
  .passthrough()
export const messageOutput = {
  type: 'object',
  description: 'Message',
  properties: {
    type: { type: 'string', description: 'Type', optional: true },
    text: { type: 'string', description: 'Text', optional: true },
    user: { type: 'string', description: 'User', optional: true },
    ts: { type: 'string', description: 'Ts' },
    permalink: { type: 'string', description: 'Permalink', optional: true },
    reactions: {
      type: 'array',
      description: 'Reactions',
      optional: true,
      items: { ...reactionOutput },
    },
  },
} satisfies ToolOutputProperty

export const itemSchema = z
  .object({
    type: z.string().optional(),
    channel: z.string().optional(),
    message: messageSchema.optional(),
    file: fileSchema.optional(),
    comment: z
      .object({
        id: z.string().optional(),
        comment: z.string().optional(),
        user: z.string().optional(),
        reactions: z.array(reactionSchema).optional(),
      })
      .passthrough()
      .optional(),
    created: z.number().optional(),
    created_by: z.string().optional(),
  })
  .passthrough()
export const itemOutput = {
  type: 'object',
  description: 'Item',
  properties: {
    type: { type: 'string', description: 'Type', optional: true },
    channel: { type: 'string', description: 'Channel', optional: true },
    message: { ...messageOutput, optional: true },
    file: { ...fileOutput, optional: true },
    comment: {
      type: 'object',
      description: 'Comment',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Id', optional: true },
        comment: { type: 'string', description: 'Comment', optional: true },
        user: { type: 'string', description: 'User', optional: true },
        reactions: {
          type: 'array',
          description: 'Reactions',
          optional: true,
          items: { ...reactionOutput },
        },
      },
    },
    created: { type: 'number', description: 'Created', optional: true },
    created_by: { type: 'string', description: 'Created by', optional: true },
  },
} satisfies ToolOutputProperty

export const pagingSchema = z
  .object({
    count: z.number().optional(),
    page: z.number().optional(),
    pages: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough()
export const pagingOutput = {
  type: 'object',
  description: 'Paging',
  properties: {
    count: { type: 'number', description: 'Count', optional: true },
    page: { type: 'number', description: 'Page', optional: true },
    pages: { type: 'number', description: 'Pages', optional: true },
    total: { type: 'number', description: 'Total', optional: true },
  },
} satisfies ToolOutputProperty

export const paginationSchema = z
  .object({
    first: z.number().optional(),
    last: z.number().optional(),
    page: z.number().optional(),
    page_count: z.number().optional(),
    per_page: z.number().optional(),
    total_count: z.number().optional(),
  })
  .passthrough()
export const paginationOutput = {
  type: 'object',
  description: 'Pagination',
  properties: {
    first: { type: 'number', description: 'First', optional: true },
    last: { type: 'number', description: 'Last', optional: true },
    page: { type: 'number', description: 'Page', optional: true },
    page_count: { type: 'number', description: 'Page count', optional: true },
    per_page: { type: 'number', description: 'Per page', optional: true },
    total_count: { type: 'number', description: 'Total count', optional: true },
  },
} satisfies ToolOutputProperty

export const metadataSchema = z.object({ next_cursor: z.string().optional() }).passthrough()
export const metadataOutput = {
  type: 'object',
  description: 'Metadata',
  properties: { next_cursor: { type: 'string', description: 'Next cursor', optional: true } },
} satisfies ToolOutputProperty

export const bookmarkSchema = z
  .object({
    id: z.string(),
    channel_id: z.string().optional(),
    title: z.string().optional(),
    link: z.string().optional(),
    emoji: z.string().optional(),
    type: z.string().optional(),
    date_created: z.number().optional(),
    date_updated: z.number().optional(),
    entity_id: z.string().nullable().optional(),
  })
  .passthrough()
export const bookmarkOutput = {
  type: 'object',
  description: 'Bookmark',
  properties: {
    id: { type: 'string', description: 'Id' },
    channel_id: { type: 'string', description: 'Channel id', optional: true },
    title: { type: 'string', description: 'Title', optional: true },
    link: { type: 'string', description: 'Link', optional: true },
    emoji: { type: 'string', description: 'Emoji', optional: true },
    type: { type: 'string', description: 'Type', optional: true },
    date_created: { type: 'number', description: 'Date created', optional: true },
    date_updated: { type: 'number', description: 'Date updated', optional: true },
    entity_id: { type: 'string', description: 'Entity id', optional: true, nullable: true },
  },
} satisfies ToolOutputProperty

export const usergroupSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    handle: z.string().optional(),
    description: z.string().optional(),
    team_id: z.string().optional(),
    users: z.array(z.string()).optional(),
    user_count: z.union([z.number(), z.string()]).optional(),
    date_create: z.number().optional(),
    date_update: z.number().optional(),
    date_delete: z.number().optional(),
    prefs: z
      .object({ channels: z.array(z.string()).optional(), groups: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
export const usergroupOutput = {
  type: 'object',
  description: 'Usergroup',
  properties: {
    id: { type: 'string', description: 'Id' },
    name: { type: 'string', description: 'Name', optional: true },
    handle: { type: 'string', description: 'Handle', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
    team_id: { type: 'string', description: 'Team id', optional: true },
    users: {
      type: 'array',
      description: 'Users',
      optional: true,
      items: { type: 'string', description: 'Users item' },
    },
    user_count: { type: 'json', description: 'User count', optional: true },
    date_create: { type: 'number', description: 'Date create', optional: true },
    date_update: { type: 'number', description: 'Date update', optional: true },
    date_delete: { type: 'number', description: 'Date delete', optional: true },
    prefs: {
      type: 'object',
      description: 'Prefs',
      optional: true,
      properties: {
        channels: {
          type: 'array',
          description: 'Channels',
          optional: true,
          items: { type: 'string', description: 'Channels item' },
        },
        groups: {
          type: 'array',
          description: 'Groups',
          optional: true,
          items: { type: 'string', description: 'Groups item' },
        },
      },
    },
  },
} satisfies ToolOutputProperty

export const searchMessageSchema = z
  .object({
    text: z.string().optional(),
    ts: z.string(),
    user: z.string().optional(),
    permalink: z.string().optional(),
    channel: conversationSchema.optional(),
  })
  .passthrough()
export const searchMessageOutput = {
  type: 'object',
  description: 'Searchmessage',
  properties: {
    text: { type: 'string', description: 'Text', optional: true },
    ts: { type: 'string', description: 'Ts' },
    user: { type: 'string', description: 'User', optional: true },
    permalink: { type: 'string', description: 'Permalink', optional: true },
    channel: { ...conversationOutput, optional: true },
  },
} satisfies ToolOutputProperty

export const messageSearchSchema = z
  .object({
    matches: z.array(searchMessageSchema),
    total: z.number(),
    paging: pagingSchema.optional(),
    pagination: paginationSchema.optional(),
  })
  .passthrough()
export const messageSearchOutput = {
  type: 'object',
  description: 'Messagesearch',
  properties: {
    matches: { type: 'array', description: 'Matches', items: { ...searchMessageOutput } },
    total: { type: 'number', description: 'Total' },
    paging: { ...pagingOutput, optional: true },
    pagination: { ...paginationOutput, optional: true },
  },
} satisfies ToolOutputProperty

export const fileSearchSchema = z
  .object({
    matches: z.array(fileSchema),
    total: z.number(),
    paging: pagingSchema.optional(),
    pagination: paginationSchema.optional(),
  })
  .passthrough()
export const fileSearchOutput = {
  type: 'object',
  description: 'Filesearch',
  properties: {
    matches: { type: 'array', description: 'Matches', items: { ...fileOutput } },
    total: { type: 'number', description: 'Total' },
    paging: { ...pagingOutput, optional: true },
    pagination: { ...paginationOutput, optional: true },
  },
} satisfies ToolOutputProperty

export const dndSchema = z
  .object({
    dnd_enabled: z.boolean().optional(),
    next_dnd_start_ts: z.number().optional(),
    next_dnd_end_ts: z.number().optional(),
    snooze_enabled: z.boolean().optional(),
    snooze_endtime: z.number().optional(),
    snooze_remaining: z.number().optional(),
    snooze_is_indefinite: z.boolean().optional(),
  })
  .passthrough()
export const dndOutput = {
  type: 'object',
  description: 'Dnd',
  properties: {
    dnd_enabled: { type: 'boolean', description: 'Dnd enabled', optional: true },
    next_dnd_start_ts: { type: 'number', description: 'Next dnd start ts', optional: true },
    next_dnd_end_ts: { type: 'number', description: 'Next dnd end ts', optional: true },
    snooze_enabled: { type: 'boolean', description: 'Snooze enabled', optional: true },
    snooze_endtime: { type: 'number', description: 'Snooze endtime', optional: true },
    snooze_remaining: { type: 'number', description: 'Snooze remaining', optional: true },
    snooze_is_indefinite: { type: 'boolean', description: 'Snooze is indefinite', optional: true },
  },
} satisfies ToolOutputProperty

export const teamSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    domain: z.string().optional(),
    email_domain: z.string().optional(),
    enterprise_id: z.string().optional(),
    enterprise_name: z.string().optional(),
    icon: z
      .object({
        image_34: z.string().optional(),
        image_132: z.string().optional(),
        image_default: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export const teamOutput = {
  type: 'object',
  description: 'Team',
  properties: {
    id: { type: 'string', description: 'Id' },
    name: { type: 'string', description: 'Name', optional: true },
    domain: { type: 'string', description: 'Domain', optional: true },
    email_domain: { type: 'string', description: 'Email domain', optional: true },
    enterprise_id: { type: 'string', description: 'Enterprise id', optional: true },
    enterprise_name: { type: 'string', description: 'Enterprise name', optional: true },
    icon: {
      type: 'object',
      description: 'Icon',
      optional: true,
      properties: {
        image_34: { type: 'string', description: 'Image 34', optional: true },
        image_132: { type: 'string', description: 'Image 132', optional: true },
        image_default: { type: 'boolean', description: 'Image default', optional: true },
      },
    },
  },
} satisfies ToolOutputProperty

export const teamProfileSchema = z
  .object({
    fields: z.array(
      z
        .object({
          id: z.string(),
          label: z.string().optional(),
          hint: z.string().optional(),
          type: z.string().optional(),
          ordering: z.number().optional(),
          is_hidden: z.boolean().optional(),
          section_id: z.string().optional(),
          possible_values: z.array(z.string()).nullable().optional(),
        })
        .passthrough()
    ),
    sections: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().optional(),
            section_type: z.string().optional(),
            order: z.number().optional(),
            is_hidden: z.boolean().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()
export const teamProfileOutput = {
  type: 'object',
  description: 'Teamprofile',
  properties: {
    fields: {
      type: 'array',
      description: 'Fields',
      items: {
        type: 'object',
        description: 'Fields item',
        properties: {
          id: { type: 'string', description: 'Id' },
          label: { type: 'string', description: 'Label', optional: true },
          hint: { type: 'string', description: 'Hint', optional: true },
          type: { type: 'string', description: 'Type', optional: true },
          ordering: { type: 'number', description: 'Ordering', optional: true },
          is_hidden: { type: 'boolean', description: 'Is hidden', optional: true },
          section_id: { type: 'string', description: 'Section id', optional: true },
          possible_values: {
            type: 'array',
            description: 'Possible values',
            optional: true,
            nullable: true,
            items: { type: 'string', description: 'Possible values item' },
          },
        },
      },
    },
    sections: {
      type: 'array',
      description: 'Sections',
      optional: true,
      items: {
        type: 'object',
        description: 'Sections item',
        properties: {
          id: { type: 'string', description: 'Id' },
          label: { type: 'string', description: 'Label', optional: true },
          section_type: { type: 'string', description: 'Section type', optional: true },
          order: { type: 'number', description: 'Order', optional: true },
          is_hidden: { type: 'boolean', description: 'Is hidden', optional: true },
        },
      },
    },
  },
} satisfies ToolOutputProperty
