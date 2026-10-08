import { isRecordLike } from '@sim/utils/object'
import type {
  BufferAccount,
  BufferAggregatedPostMetrics,
  BufferChannel,
  BufferDailyPostingLimitStatus,
  BufferIdea,
  BufferIdeaGroup,
  BufferPaginationPageInfo,
  BufferPost,
} from '@/tools/buffer/types'
import type { OutputProperty } from '@/tools/types'

interface BufferSchemaType {
  fields?: Record<string, string>
  members?: string[]
  values?: string[]
  defaults?: string[]
  oneOf?: boolean
}

interface BufferOutputTypes {
  Account: BufferAccount
  AggregatedPostMetrics: BufferAggregatedPostMetrics
  Channel: BufferChannel
  DailyPostingLimitStatus: BufferDailyPostingLimitStatus
  Idea: BufferIdea
  IdeaGroup: BufferIdeaGroup
  PaginationPageInfo: BufferPaginationPageInfo
  Post: BufferPost
}

function baseType(type: string): string {
  return type.replace(/[[\]!]/g, '')
}

function scalarType(type: string): 'string' | 'number' | 'boolean' {
  if (type === 'Int' || type === 'Float') return 'number'
  if (type === 'Boolean') return 'boolean'
  return 'string'
}

/** Builds complete selections, expanding GraphQL unions and interfaces with fragments. */
export function bufferSelection(type: string): string {
  const schema = BUFFER_SCHEMA[type]
  if (!schema) return ''
  if (schema.members?.length) {
    return `__typename ${schema.members.map((member) => `... on ${member} { ${bufferSelection(member)} }`).join(' ')}`
  }
  return Object.entries(schema.fields ?? {})
    .map(([field, wireType]) => {
      const selection = bufferSelection(baseType(wireType))
      return selection ? `${field} { ${selection} }` : field
    })
    .join(' ')
}

/** Describes every documented response field, with nullable network-specific variants. */
export function bufferOutputProperties(type: string): Record<string, OutputProperty> {
  const schema = BUFFER_SCHEMA[type]
  if (!schema) return {}
  if (schema.members?.length) {
    const properties: Record<string, OutputProperty> = {
      __typename: { type: 'string', description: `Concrete ${type} variant` },
    }
    for (const member of schema.members) {
      for (const [field, property] of Object.entries(bufferOutputProperties(member))) {
        properties[field] = { ...property, optional: true }
      }
    }
    return properties
  }
  const properties: Record<string, OutputProperty> = {}
  for (const [field, wireType] of Object.entries(schema.fields ?? {})) {
    const nestedType = baseType(wireType)
    const nested = BUFFER_SCHEMA[nestedType]
    const object = Boolean(nested?.fields || nested?.members)
    const property: OutputProperty = {
      type: object ? 'object' : scalarType(nestedType),
      description: `${type} ${field}`,
      ...(object ? { properties: bufferOutputProperties(nestedType) } : {}),
    }
    properties[field] = wireType.startsWith('[')
      ? {
          type: 'array',
          description: `${type} ${field}`,
          nullable: !wireType.endsWith('!'),
          items: {
            ...property,
            nullable: !(wireType.endsWith('!') ? wireType.slice(0, -1) : wireType)
              .slice(1, -1)
              .endsWith('!'),
          },
        }
      : { ...property, nullable: !wireType.endsWith('!') }
  }
  return properties
}

/** Projects only documented fields; GraphQL concrete variants keep their discriminator. */
export function projectBufferObject<T extends keyof BufferOutputTypes>(
  type: T,
  value: unknown
): BufferOutputTypes[T]
export function projectBufferObject(type: string, value: unknown): Record<string, unknown>
export function projectBufferObject(type: string, value: unknown): unknown {
  if (!isRecordLike(value)) throw new Error(`Buffer returned an invalid ${type}`)
  const schema = BUFFER_SCHEMA[type]
  if (!schema) throw new Error(`Unknown Buffer output type ${type}`)
  if (schema.members?.length) {
    const member = value.__typename
    if (typeof member !== 'string' || !schema.members.includes(member))
      throw new Error(`Buffer returned an invalid ${type} variant`)
    return { __typename: member, ...projectBufferObject(member, value) }
  }
  const result: Record<string, unknown> = {}
  for (const [field, wireType] of Object.entries(schema.fields ?? {})) {
    const candidate = value[field]
    const nestedType = baseType(wireType)
    const nested = BUFFER_SCHEMA[nestedType]
    const object = Boolean(nested?.fields || nested?.members)
    if (candidate == null) {
      if (wireType.endsWith('!')) throw new Error(`Buffer returned null for ${type}.${field}`)
      result[field] = null
    } else if (wireType.startsWith('[')) {
      if (!Array.isArray(candidate)) throw new Error(`Buffer returned an invalid ${type}.${field}`)
      const listType = wireType.endsWith('!') ? wireType.slice(0, -1) : wireType
      const itemRequired = listType.slice(1, -1).endsWith('!')
      result[field] = candidate.map((entry) => {
        if (entry == null) {
          if (itemRequired) throw new Error(`Buffer returned null for ${type}.${field}[]`)
          return null
        }
        return object ? projectBufferObject(nestedType, entry) : entry
      })
    } else {
      result[field] = object ? projectBufferObject(nestedType, candidate) : candidate
    }
  }
  return result
}

/** Validates structured inputs against the published field names, types and enums. */
export function parseBufferInput(
  type: string,
  value: unknown,
  path = type
): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!isRecordLike(parsed)) throw new Error(`${path} must be a JSON object`)
  const schema = BUFFER_SCHEMA[type]
  if (!schema?.fields) throw new Error(`Unknown Buffer input type ${type}`)
  for (const field of Object.keys(parsed)) {
    if (!Object.hasOwn(schema.fields, field))
      throw new Error(`Unknown Buffer input ${path}.${field}`)
  }
  if (type === 'AssetInput' && Object.values(parsed).filter((entry) => entry != null).length !== 1)
    throw new Error(`${path} requires exactly one of image, video or document`)
  const result: Record<string, unknown> = {}
  for (const [field, wireType] of Object.entries(schema.fields)) {
    const candidate = parsed[field]
    if (candidate === undefined && (!wireType.endsWith('!') || schema.defaults?.includes(field)))
      continue
    result[field] = parseValue(wireType, candidate, `${path}.${field}`)
  }
  if (schema.oneOf && (Object.keys(result).length !== 1 || Object.values(result)[0] == null))
    throw new Error(`${path} requires exactly one field`)
  return result
}

/** Describes structured inputs with a readable definition for each referenced type. */
export function bufferInputDescription(type: string, description: string): string {
  const definitions: string[] = []
  const visited = new Set<string>()

  function collect(name: string): void {
    const schema = BUFFER_SCHEMA[name]
    if (visited.has(name) || (!schema?.fields && !schema?.values)) return
    visited.add(name)
    if (schema.fields) {
      const fields = Object.entries(schema.fields).map(
        ([field, wireType]) =>
          `  ${field}: ${wireType}${schema.defaults?.includes(field) ? ' # Provider default when omitted' : ''}`
      )
      if (schema.oneOf) fields.unshift('  # Choose exactly one non-null field')
      definitions.push(`input ${name} {\n${fields.join('\n')}\n}`)
      for (const wireType of Object.values(schema.fields)) collect(baseType(wireType))
    } else if (schema.values) {
      definitions.push(
        `enum ${name} {\n${schema.values.map((value) => `  ${value}`).join('\n')}\n}`
      )
    }
  }

  collect(type)
  return definitions.length
    ? `${description}\n\n\`\`\`graphql\n${definitions.join('\n\n')}\n\`\`\``
    : description
}

function parseValue(wireType: string, value: unknown, path: string): unknown {
  if (value == null) {
    if (wireType.endsWith('!')) throw new Error(`${path} is required`)
    return null
  }
  const type = wireType.endsWith('!') ? wireType.slice(0, -1) : wireType
  if (type.startsWith('[')) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
    if (value.length > 1000) throw new Error(`${path} exceeds the integration limit of 1000 items`)
    return value.map((entry, index) => parseValue(type.slice(1, -1), entry, `${path}[${index}]`))
  }
  const schema = BUFFER_SCHEMA[type]
  if (schema?.fields) return parseBufferInput(type, value, path)
  if (typeof value !== scalarType(type)) throw new Error(`${path} must be a ${scalarType(type)}`)
  if (schema?.values && !schema.values.includes(String(value)))
    throw new Error(`${path} must be one of ${schema.values.join(', ')}`)
  if (type === 'Int' && !Number.isInteger(value)) throw new Error(`${path} must be an integer`)
  if ((type === 'Int' || type === 'Float') && !Number.isFinite(value))
    throw new Error(`${path} must be finite`)
  if (type === 'DateTime' && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))
    throw new Error(`${path} must be an ISO 8601 timestamp`)
  return value
}

/** Published Buffer GraphQL fields, including concrete media and network metadata variants.
 * Sources: https://developers.buffer.com/reference.md and live API introspection (2026-10-07).
 */
const BUFFER_SCHEMA: Record<string, BufferSchemaType> = {
  Account: {
    fields: {
      id: 'ID!',
      email: 'String!',
      backupEmail: 'String',
      avatar: 'String!',
      createdAt: 'DateTime',
      organizations: '[Organization!]!',
      timezone: 'String',
      name: 'String',
      preferences: 'Preferences',
      connectedApps: '[ConnectedApp!]',
    },
  },
  AggregatedPostMetrics: {
    fields: {
      metrics: '[PostMetric!]!',
      metricsUpdatedAt: 'DateTime',
    },
  },
  AggregatedPostMetricsInput: {
    fields: {
      channelIds: '[ChannelId!]',
      endDateTime: 'DateTime!',
      organizationId: 'OrganizationId!',
      startDateTime: 'DateTime!',
      tags: 'TagComparator',
    },
  },
  Annotation: {
    fields: {
      content: 'String!',
      indices: '[Int!]!',
      text: 'String!',
      type: 'AnnotationType!',
      url: 'String!',
    },
  },
  AnnotationInputFacebook: {
    fields: {
      content: 'String!',
      indices: '[Int!]!',
      text: 'String!',
      url: 'String!',
    },
  },
  AnnotationInputLinkedIn: {
    fields: {
      id: 'String!',
      entity: 'String!',
      length: 'Int!',
      link: 'String!',
      localizedName: 'String!',
      start: 'Int!',
      vanityName: 'String!',
    },
  },
  AnnotationType: {
    values: [
      'annotation',
      'bold',
      'bulletedListItem',
      'cashtag',
      'hashtag',
      'heading',
      'italic',
      'mention',
      'orderedListItem',
      'strikethrough',
      'url',
    ],
  },
  Asset: {
    fields: {
      id: 'ID',
      mimeType: 'String!',
      source: 'String!',
      thumbnail: 'String!',
      type: 'AssetType!',
    },
    members: ['DocumentAsset', 'ImageAsset', 'VideoAsset'],
  },
  AssetInput: {
    fields: {
      document: 'DocumentAssetInput',
      image: 'ImageAssetInput',
      video: 'VideoAssetInput',
    },
  },
  AssetType: {
    values: ['document', 'image', 'video'],
  },
  Author: {
    fields: {
      id: 'AccountId!',
      avatar: 'String!',
      email: 'String!',
      isDeleted: 'Boolean!',
      name: 'String',
      urn: 'String',
    },
  },
  BlueskyMetadata: {
    fields: {
      serverUrl: 'String!',
    },
  },
  BlueskyPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      linkAttachment: 'LinkAttachment',
      thread: '[ThreadedPost!]!',
      threadCount: 'Int!',
      type: 'PostType!',
    },
  },
  BlueskyPostMetadataInput: {
    fields: {
      linkAttachment: 'LinkAttachmentInput',
      thread: '[ThreadedPostInput!]',
    },
  },
  Channel: {
    fields: {
      id: 'ChannelId!',
      allowedActions: '[ChannelAction!]!',
      avatar: 'String!',
      descriptor: 'String!',
      displayName: 'String',
      externalLink: 'String',
      hasActiveMemberDevice: 'Boolean!',
      isDisconnected: 'Boolean!',
      isLocked: 'Boolean!',
      isNew: 'Boolean!',
      isQueuePaused: 'Boolean!',
      linkShortening: 'ChannelLinkShortening!',
      metadata: 'ChannelMetadata',
      name: 'String!',
      organizationId: 'OrganizationId!',
      postingGoal: 'PostingGoal',
      postingSchedule: '[ScheduleV2!]!',
      products: '[Product!]',
      scopes: '[String]!',
      service: 'Service!',
      serviceId: 'String!',
      showTrendingTopicSuggestions: 'Boolean!',
      timezone: 'String!',
      type: 'ChannelType!',
      weeklyPostingLimit: 'WeeklyPostingLimit',
      createdAt: 'DateTime!',
      updatedAt: 'DateTime!',
    },
  },
  ChannelAction: {
    values: [
      'backfillChannel',
      'exportInsights',
      'manageCapabilities',
      'manageChannelSettings',
      'manageComments',
      'manageDms',
      'manageIntegrations',
      'managePostingSchedule',
      'manageUpdates',
      'publishStartPage',
      'readUpdates',
      'reconnectChannel',
      'removeChannel',
      'scheduleUpdates',
      'viewCapabilities',
      'viewChannel',
      'viewComments',
      'viewDms',
      'viewInsights',
      'viewPublish',
      'viewUpdates',
    ],
  },
  ChannelLinkShortening: {
    fields: {
      config: 'LinkShorteningConfig',
      isEnabled: 'Boolean!',
    },
  },
  ChannelMetadata: {
    members: [
      'InstagramMetadata',
      'TiktokMetadata',
      'YoutubeMetadata',
      'PinterestMetadata',
      'MastodonMetadata',
      'BlueskyMetadata',
      'GoogleBusinessMetadata',
      'FacebookMetadata',
      'TwitterMetadata',
      'LinkedInMetadata',
      'WhatsAppMetadata',
    ],
  },
  ChannelType: {
    values: ['account', 'business', 'channel', 'group', 'page', 'profile'],
  },
  ChannelsFiltersInput: {
    fields: {
      isLocked: 'Boolean',
      product: 'Product',
    },
  },
  ChannelsInput: {
    fields: {
      filter: 'ChannelsFiltersInput',
      organizationId: 'OrganizationId!',
    },
  },
  ConnectedApp: {
    fields: {
      category: 'ConnectedAppCategory',
      clientId: 'ID!',
      description: 'String!',
      name: 'String!',
      scopes: '[String!]!',
      userId: 'ID!',
      website: 'String!',
      createdAt: 'DateTime!',
    },
  },
  ConnectedAppCategory: {
    values: ['mcp'],
  },
  CreateIdeaInput: {
    fields: {
      content: 'IdeaContentInput!',
      cta: 'String',
      group: 'IdeaGroupInput',
      organizationId: 'ID!',
      templateId: 'String',
    },
  },
  CreatePostInput: {
    fields: {
      aiAssisted: 'Boolean',
      assets: '[AssetInput!]!',
      channelId: 'ChannelId!',
      draftId: 'DraftId',
      dueAt: 'DateTime',
      ideaId: 'IdeaId',
      metadata: 'PostInputMetaData',
      mode: 'ShareMode!',
      needsApproval: 'Boolean!',
      saveToDraft: 'Boolean',
      schedulingType: 'SchedulingType!',
      source: 'String',
      tagIds: '[TagId!]',
      text: 'String',
    },
    defaults: ['assets', 'needsApproval'],
  },
  DailyPostingLimitStatus: {
    fields: {
      channelId: 'ChannelId!',
      isAtLimit: 'Boolean!',
      limit: 'Int',
      scheduled: 'Int!',
      sent: 'Int!',
    },
  },
  DailyPostingLimitsInput: {
    fields: {
      channelIds: '[ChannelId!]!',
      date: 'DateTime',
    },
  },
  DateTimeComparator: {
    fields: {
      end: 'DateTime',
      start: 'DateTime',
    },
  },
  DateTimePresence: {
    values: ['absent', 'present'],
  },
  DayOfWeek: {
    values: ['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'],
  },
  DocumentAsset: {
    fields: {
      id: 'ID',
      document: 'DocumentMetadata!',
      mimeType: 'String!',
      source: 'String!',
      thumbnail: 'String!',
      type: 'AssetType!',
    },
  },
  DocumentAssetInput: {
    fields: {
      thumbnailUrl: 'String!',
      title: 'String!',
      url: 'String!',
    },
  },
  DocumentMetadata: {
    fields: {
      filesize: 'Int',
      numPages: 'Int!',
      thumbnails: '[String!]!',
      title: 'String',
    },
  },
  EditPostInput: {
    fields: {
      id: 'PostId!',
      aiAssisted: 'Boolean',
      approvalChange: 'PostApprovalChange',
      assets: '[AssetInput!]',
      draftId: 'DraftId',
      dueAt: 'DateTime',
      ideaId: 'IdeaId',
      metadata: 'PostInputMetaData',
      mode: 'ShareMode',
      saveToDraft: 'Boolean',
      schedulingType: 'SchedulingType',
      source: 'String',
      tagIds: '[TagId!]',
      text: 'String',
    },
  },
  FacebookMetadata: {
    fields: {
      locationData: 'LocationData',
    },
  },
  FacebookPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      firstComment: 'String',
      linkAttachment: 'LinkAttachment',
      title: 'String',
      type: 'PostType!',
    },
  },
  FacebookPostMetadataInput: {
    fields: {
      annotations: '[AnnotationInputFacebook!]',
      firstComment: 'String',
      linkAttachment: 'LinkAttachmentInput',
      type: 'PostTypeFacebook!',
    },
  },
  GoogleBusinessEventMetaData: {
    fields: {
      button: 'GoogleBusinessPostActionType!',
      endDate: 'DateTime!',
      endTime: 'String',
      isFullDayEvent: 'Boolean!',
      link: 'String',
      startDate: 'DateTime!',
      startTime: 'String',
      title: 'String!',
    },
  },
  GoogleBusinessEventMetaDataInput: {
    fields: {
      button: 'GoogleBusinessPostActionType',
      endDate: 'DateTime',
      isFullDayEvent: 'Boolean!',
      link: 'String',
      startDate: 'DateTime',
      title: 'String',
    },
  },
  GoogleBusinessMetadata: {
    fields: {
      locationData: 'LocationData',
    },
  },
  GoogleBusinessOfferMetaData: {
    fields: {
      code: 'String',
      endDate: 'DateTime!',
      link: 'String',
      startDate: 'DateTime!',
      terms: 'String',
      title: 'String!',
    },
  },
  GoogleBusinessOfferMetaDataInput: {
    fields: {
      code: 'String',
      endDate: 'DateTime',
      link: 'String',
      startDate: 'DateTime',
      terms: 'String',
      title: 'String',
    },
  },
  GoogleBusinessPostActionType: {
    values: ['book', 'call', 'learn_more', 'none', 'order', 'shop', 'signup'],
  },
  GoogleBusinessPostDetails: {
    members: [
      'GoogleBusinessWhatsNewMetaData',
      'GoogleBusinessOfferMetaData',
      'GoogleBusinessEventMetaData',
    ],
  },
  GoogleBusinessPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      details: 'GoogleBusinessPostDetails',
      title: 'String',
      type: 'PostType!',
    },
  },
  GoogleBusinessPostMetadataInput: {
    fields: {
      detailsEvent: 'GoogleBusinessEventMetaDataInput',
      detailsOffer: 'GoogleBusinessOfferMetaDataInput',
      detailsWhatsNew: 'GoogleBusinessWhatsNewMetaDataInput',
      title: 'String',
      type: 'PostTypeGoogleBusiness!',
    },
  },
  GoogleBusinessWhatsNewMetaData: {
    fields: {
      button: 'GoogleBusinessPostActionType!',
      link: 'String',
    },
  },
  GoogleBusinessWhatsNewMetaDataInput: {
    fields: {
      button: 'GoogleBusinessPostActionType',
      link: 'String',
    },
  },
  Idea: {
    fields: {
      id: 'ID!',
      content: 'IdeaContent!',
      groupId: 'ID',
      organizationId: 'ID!',
      position: 'Float',
      createdAt: 'Int!',
      updatedAt: 'Int!',
    },
  },
  IdeaContent: {
    fields: {
      aiAssisted: 'Boolean!',
      date: 'DateTime',
      media: '[IdeaMedia!]',
      services: '[Service!]!',
      tags: '[PublishingTag!]!',
      text: 'String',
      title: 'String',
    },
  },
  IdeaContentInput: {
    fields: {
      aiAssisted: 'Boolean',
      date: 'DateTime',
      media: '[IdeaMediaInput!]',
      services: '[Service!]',
      tags: '[TagInput!]',
      text: 'String',
      title: 'String',
    },
  },
  IdeaGroup: {
    fields: {
      id: 'ID!',
      isLocked: 'Boolean!',
      name: 'String!',
    },
  },
  IdeaGroupInput: {
    fields: {
      groupId: 'ID',
      placeAfterId: 'ID',
    },
  },
  IdeaGroupMembership: {
    values: ['grouped', 'ungrouped'],
  },
  IdeaMedia: {
    fields: {
      id: 'ID!',
      alt: 'String',
      size: 'Int',
      source: 'IdeaMediaSource',
      thumbnailUrl: 'String',
      type: 'MediaType!',
      url: 'String!',
    },
  },
  IdeaMediaInput: {
    fields: {
      url: 'String!',
      alt: 'String',
      thumbnailUrl: 'String',
      type: 'MediaType!',
      size: 'Int',
      source: 'IdeaMediaSourceInput',
    },
  },
  IdeaMediaSource: {
    fields: {
      id: 'String',
      author: 'String',
      authorUrl: 'String',
      name: 'String!',
    },
  },
  IdeaMediaSourceInput: {
    fields: {
      name: 'String!',
      id: 'String',
      trigger: 'String',
      author: 'String',
      authorUrl: 'String',
    },
  },
  IdeasGroupFilter: {
    fields: {
      groups: '[ID!]',
      membership: 'IdeaGroupMembership',
    },
    oneOf: true,
  },
  IdeasInput: {
    fields: {
      groupFilter: 'IdeasGroupFilter',
      organizationId: 'OrganizationId!',
      tagsFilter: 'TagComparator',
    },
  },
  ImageAsset: {
    fields: {
      id: 'ID',
      image: 'ImageMetadata!',
      mimeType: 'String!',
      source: 'String!',
      thumbnail: 'String!',
      type: 'AssetType!',
    },
  },
  ImageAssetInput: {
    fields: {
      metadata: 'ImageMetadataInput',
      thumbnailUrl: 'String',
      url: 'String!',
    },
  },
  ImageMetadata: {
    fields: {
      altText: 'String!',
      animatedThumbnail: 'String',
      height: 'Int!',
      isAnimated: 'Boolean!',
      userTags: '[UserTag!]',
      width: 'Int!',
    },
  },
  ImageMetadataInput: {
    fields: {
      altText: 'String!',
      animatedThumbnail: 'String',
      userTags: '[UserTagInput!]',
    },
  },
  InstagramGeolocation: {
    fields: {
      id: 'String',
      text: 'String',
    },
  },
  InstagramGeolocationInput: {
    fields: {
      id: 'String',
      text: 'String',
    },
  },
  InstagramMetadata: {
    fields: {
      defaultToReminders: 'Boolean!',
    },
  },
  InstagramPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      firstComment: 'String',
      geolocation: 'InstagramGeolocation',
      isAiGenerated: 'Boolean!',
      link: 'String',
      shouldShareToFeed: 'Boolean!',
      stickerFields: 'InstagramStickerFields',
      type: 'PostType!',
    },
  },
  InstagramPostMetadataInput: {
    fields: {
      firstComment: 'String',
      geolocation: 'InstagramGeolocationInput',
      isAiGenerated: 'Boolean',
      link: 'String',
      shouldShareToFeed: 'Boolean!',
      stickerFields: 'InstagramStickerFieldsInput',
      type: 'PostType!',
    },
  },
  InstagramStickerFields: {
    fields: {
      music: 'String',
      other: 'String',
      products: 'String',
      text: 'String',
      topics: 'String',
    },
  },
  InstagramStickerFieldsInput: {
    fields: {
      music: 'String',
      other: 'String',
      products: 'String',
      text: 'String',
      topics: 'String',
    },
  },
  LinkAttachment: {
    fields: {
      expandedUrl: 'String',
      text: 'String!',
      thumbnail: 'String',
      thumbnails: '[String!]!',
      title: 'String!',
      url: 'String!',
    },
  },
  LinkAttachmentInput: {
    fields: {
      description: 'String',
      thumbnail: 'LinkAttachmentThumbnailInput',
      title: 'String',
      url: 'String!',
    },
  },
  LinkAttachmentThumbnailInput: {
    fields: {
      url: 'String!',
    },
  },
  LinkShorteningConfig: {
    fields: {
      domain: 'String!',
      name: 'String!',
    },
  },
  LinkedInMetadata: {
    fields: {
      shouldShowLinkedinAnalyticsRefreshBanner: 'Boolean!',
    },
  },
  LinkedInPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      firstComment: 'String',
      linkAttachment: 'LinkAttachment',
      type: 'PostType!',
    },
  },
  LinkedInPostMetadataInput: {
    fields: {
      annotations: '[AnnotationInputLinkedIn!]',
      firstComment: 'String',
      linkAttachment: 'LinkAttachmentInput',
    },
  },
  LocationData: {
    fields: {
      googleAccountId: 'String',
      location: 'String',
      mapsLink: 'String',
    },
  },
  MastodonMetadata: {
    fields: {
      maxCharacters: 'Int!',
      serverUrl: 'String!',
    },
  },
  MastodonPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      spoilerText: 'String',
      thread: '[ThreadedPost!]!',
      threadCount: 'Int!',
      type: 'PostType!',
    },
  },
  MastodonPostMetadataInput: {
    fields: {
      spoilerText: 'String',
      thread: '[ThreadedPostInput!]',
    },
  },
  MediaType: {
    values: ['image', 'gif', 'video', 'link', 'document', 'unsupported'],
  },
  MemberConnection: {
    fields: {
      totalCount: 'Int!',
    },
  },
  Note: {
    fields: {
      id: 'NoteId!',
      allowedActions: '[NoteAction!]!',
      author: 'Author!',
      text: 'String!',
      type: 'NoteType!',
      createdAt: 'DateTime!',
      updatedAt: 'DateTime',
    },
  },
  NoteAction: {
    values: ['deleteNote', 'reactToNote', 'updateNote'],
  },
  NoteType: {
    values: ['aiGenerated', 'bufferGenerated', 'userGenerated'],
  },
  NotificationStatus: {
    values: ['markedAsPublished', 'notified'],
  },
  Organization: {
    fields: {
      id: 'OrganizationId!',
      channelCount: 'Int!',
      limits: 'OrganizationLimits!',
      members: 'MemberConnection!',
      name: 'String!',
      ownerEmail: 'String!',
      shouldEnforce2FASetup: 'Boolean!',
    },
  },
  OrganizationFilterInput: {
    fields: {
      organizationId: 'String!',
    },
  },
  OrganizationLimits: {
    fields: {
      channels: 'Int!',
      generateContent: 'Int!',
      ideaGroups: 'Int!',
      ideas: 'Int!',
      members: 'Int!',
      postTemplates: 'Int!',
      savedReplies: 'Int!',
      scheduledPosts: 'Int!',
      scheduledStoriesPerChannel: 'Int!',
      scheduledThreadsPerChannel: 'Int!',
      tags: 'Int!',
    },
  },
  PaginationPageInfo: {
    fields: {
      endCursor: 'String',
      hasNextPage: 'Boolean!',
      hasPreviousPage: 'Boolean!',
      startCursor: 'String',
    },
  },
  PinterestBoard: {
    fields: {
      id: 'String!',
      avatar: 'String',
      description: 'String',
      name: 'String!',
      serviceId: 'String!',
      url: 'String!',
    },
  },
  PinterestMetadata: {
    fields: {
      boards: '[PinterestBoard!]!',
    },
  },
  PinterestPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      board: 'PinterestBoard',
      title: 'String',
      type: 'PostType!',
      url: 'String',
    },
  },
  PinterestPostMetadataInput: {
    fields: {
      boardServiceId: 'String',
      title: 'String',
      url: 'String',
    },
  },
  Post: {
    fields: {
      id: 'PostId!',
      allowedActions: '[PostAction!]!',
      assets: '[Asset!]!',
      author: 'Author',
      channel: 'Channel!',
      channelId: 'ChannelId!',
      channelService: 'Service!',
      contentItemId: 'ContentItemId',
      dueAt: 'DateTime',
      error: 'PostPublishingError',
      externalLink: 'String',
      ideaId: 'IdeaId',
      isCustomScheduled: 'Boolean!',
      metadata: 'PostMetadata',
      metrics: '[PostMetric!]',
      metricsUpdatedAt: 'DateTime',
      notes: '[Note!]!',
      notificationStatus: 'NotificationStatus',
      schedulingType: 'SchedulingType',
      sentAt: 'DateTime',
      sharedNow: 'Boolean!',
      shareMode: 'ShareMode!',
      status: 'PostStatus!',
      tags: '[Tag!]!',
      text: 'String!',
      via: 'PostVia!',
      createdAt: 'DateTime!',
      updatedAt: 'DateTime!',
    },
  },
  PostAction: {
    values: [
      'addPostNote',
      'addPostToQueue',
      'approvePost',
      'cancelPostRecurrence',
      'copyPostLink',
      'createPostRecurrence',
      'deletePost',
      'duplicatePost',
      'editPostRecurrence',
      'movePostToDraft',
      'publishPostNext',
      'publishPostNow',
      'rejectPost',
      'removePostScheduledTime',
      'requestPostApproval',
      'revertPostApprovalRequest',
      'sharePostLink',
      'updatePost',
      'updatePostSchedule',
      'updatePostTags',
      'updateShopGridLink',
      'viewPost',
    ],
  },
  PostApprovalChange: {
    values: ['request', 'revert'],
  },
  PostInputMetaData: {
    fields: {
      bluesky: 'BlueskyPostMetadataInput',
      facebook: 'FacebookPostMetadataInput',
      google: 'GoogleBusinessPostMetadataInput',
      instagram: 'InstagramPostMetadataInput',
      linkedin: 'LinkedInPostMetadataInput',
      mastodon: 'MastodonPostMetadataInput',
      pinterest: 'PinterestPostMetadataInput',
      substack: 'SubstackPostMetadataInput',
      threads: 'ThreadsPostMetadataInput',
      tiktok: 'TikTokPostMetadataInput',
      twitter: 'TwitterPostMetadataInput',
      youtube: 'YoutubePostMetadataInput',
    },
  },
  PostMetadata: {
    members: [
      'InstagramPostMetadata',
      'FacebookPostMetadata',
      'LinkedInPostMetadata',
      'TwitterPostMetadata',
      'PinterestPostMetadata',
      'GoogleBusinessPostMetadata',
      'YoutubePostMetadata',
      'MastodonPostMetadata',
      'TiktokPostMetadata',
      'ThreadsPostMetadata',
      'BlueskyPostMetadata',
      'SubstackPostMetadata',
    ],
  },
  PostMetric: {
    fields: {
      description: 'String!',
      name: 'String!',
      type: 'PostMetricType!',
      unit: 'PostMetricUnit!',
      value: 'Float!',
    },
  },
  PostMetricType: {
    values: [
      'averageTimeWatched',
      'clicks',
      'comments',
      'engagementRate',
      'favorites',
      'follows',
      'freeSubscriptions',
      'impressions',
      'likes',
      'link_clicks',
      'other',
      'paidSubscriptions',
      'postCount',
      'quotes',
      'reach',
      'reactions',
      'reblogs',
      'repins',
      'replies',
      'reposts',
      'retweets',
      'saves',
      'shares',
      'totalTimeWatched',
      'viewers',
      'views',
    ],
  },
  PostMetricUnit: {
    values: ['count', 'percentage'],
  },
  PostPublishingError: {
    fields: {
      message: 'String!',
      rawError: 'String',
      supportUrl: 'String',
    },
  },
  PostSortInput: {
    fields: {
      direction: 'SortDirection!',
      field: 'PostSortableKey!',
    },
  },
  PostSortableKey: {
    values: ['dueAt', 'createdAt'],
  },
  PostStatus: {
    values: ['draft', 'error', 'needs_approval', 'scheduled', 'sending', 'sent'],
  },
  PostType: {
    values: [
      'carousel',
      'event',
      'ghost_post',
      'offer',
      'post',
      'reel',
      'short',
      'story',
      'thread',
      'whats_new',
    ],
  },
  PostTypeFacebook: {
    values: ['post', 'reel', 'story'],
  },
  PostTypeGoogleBusiness: {
    values: ['event', 'offer', 'whats_new'],
  },
  PostVia: {
    values: ['api', 'buffer', 'network'],
  },
  PostingGoal: {
    fields: {
      goal: 'Int!',
      periodEnd: 'DateTime!',
      periodStart: 'DateTime!',
      scheduledCount: 'Int!',
      sentCount: 'Int!',
      status: 'PostingGoalStatus!',
    },
  },
  PostingGoalStatus: {
    values: ['AtRisk', 'Hit', 'OnTrack'],
  },
  PostsFiltersInput: {
    fields: {
      channelIds: '[ChannelId!]',
      dueAt: 'DateTimeComparator',
      dueAtPresence: 'DateTimePresence',
      postTypes: '[PostType!]',
      status: '[PostStatus!]',
      tags: 'TagComparator',
      createdAt: 'DateTimeComparator',
    },
  },
  PostsInput: {
    fields: {
      filter: 'PostsFiltersInput',
      organizationId: 'OrganizationId!',
      sort: '[PostSortInput!]',
    },
  },
  Preferences: {
    fields: {
      timeFormat: 'String',
      startOfWeek: 'String',
      defaultScheduleOption: 'ScheduleOption!',
    },
  },
  Product: {
    values: ['analyze', 'buffer', 'comments', 'engage', 'publish', 'startPage'],
  },
  PublishingTag: {
    fields: {
      id: 'ID!',
      color: 'String!',
      colorName: 'TagColorName',
      name: 'String!',
    },
  },
  RetweetMetadata: {
    fields: {
      id: 'String!',
      text: 'String!',
      thumbnails: '[String!]!',
      url: 'String!',
      user: 'RetweetUserMetadata!',
      createdAt: 'DateTime!',
    },
  },
  RetweetMetadataInput: {
    fields: {
      id: 'String!',
      comment: 'String',
    },
  },
  RetweetUserMetadata: {
    fields: {
      avatar: 'String!',
      name: 'String!',
      username: 'String!',
    },
  },
  ScheduleOption: {
    values: ['Queue', 'Prioritize', 'FixedTime', 'Now'],
  },
  ScheduleV2: {
    fields: {
      day: 'DayOfWeek!',
      paused: 'Boolean!',
      times: '[String!]!',
    },
  },
  SchedulingType: {
    values: ['automatic', 'notification'],
  },
  Service: {
    values: [
      'bluesky',
      'facebook',
      'googlebusiness',
      'instagram',
      'linkedin',
      'mastodon',
      'pinterest',
      'startPage',
      'substack',
      'threads',
      'tiktok',
      'twitter',
      'whatsapp',
      'youtube',
    ],
  },
  ShareMode: {
    values: ['addToQueue', 'customScheduled', 'shareNext', 'shareNow'],
  },
  SortDirection: {
    values: ['asc', 'desc'],
  },
  SubstackPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      linkAttachment: 'LinkAttachment',
      type: 'PostType!',
    },
  },
  SubstackPostMetadataInput: {
    fields: {
      linkAttachment: 'LinkAttachmentInput',
    },
  },
  Tag: {
    fields: {
      id: 'TagId!',
      color: 'String!',
      colorName: 'TagColorName',
      isLocked: 'Boolean!',
      name: 'String!',
    },
  },
  TagColorName: {
    values: [
      'blue',
      'blueLight',
      'gray',
      'grayLight',
      'green',
      'greenLight',
      'orange',
      'orangeLight',
      'pink',
      'pinkLight',
      'purple',
      'purpleLight',
      'red',
      'redLight',
      'teal',
      'tealLight',
      'yellow',
      'yellowLight',
    ],
  },
  TagComparator: {
    fields: {
      in: '[TagId!]!',
      isEmpty: 'Boolean!',
    },
    defaults: ['isEmpty'],
  },
  TagInput: {
    fields: {
      id: 'ID!',
      name: 'String!',
      color: 'String!',
    },
  },
  ThreadItemBlueskyMetadata: {
    fields: {
      linkAttachment: 'LinkAttachment',
    },
  },
  ThreadItemBlueskyMetadataInput: {
    fields: {
      linkAttachment: 'LinkAttachmentInput',
    },
  },
  ThreadItemMetadata: {
    fields: {
      bluesky: 'ThreadItemBlueskyMetadata',
      threads: 'ThreadItemThreadsMetadata',
    },
  },
  ThreadItemMetadataInput: {
    fields: {
      bluesky: 'ThreadItemBlueskyMetadataInput',
      threads: 'ThreadItemThreadsMetadataInput',
    },
  },
  ThreadItemThreadsMetadata: {
    fields: {
      linkAttachment: 'LinkAttachment',
    },
  },
  ThreadItemThreadsMetadataInput: {
    fields: {
      linkAttachment: 'LinkAttachmentInput',
    },
  },
  ThreadedPost: {
    fields: {
      assets: '[Asset!]!',
      linkAttachment: 'LinkAttachment',
      metadata: 'ThreadItemMetadata',
      text: 'String!',
    },
  },
  ThreadedPostInput: {
    fields: {
      assets: '[AssetInput!]!',
      metadata: 'ThreadItemMetadataInput',
      text: 'String',
    },
    defaults: ['assets'],
  },
  ThreadsPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      linkAttachment: 'LinkAttachment',
      locationId: 'String',
      locationName: 'String',
      thread: '[ThreadedPost!]!',
      threadCount: 'Int!',
      topic: 'String',
      type: 'PostType!',
    },
  },
  ThreadsPostMetadataInput: {
    fields: {
      linkAttachment: 'LinkAttachmentInput',
      locationId: 'String',
      locationName: 'String',
      thread: '[ThreadedPostInput!]',
      topic: 'String',
      type: 'PostType',
    },
  },
  TikTokPostMetadataInput: {
    fields: {
      isAiGenerated: 'Boolean',
      title: 'String',
    },
  },
  TiktokMetadata: {
    fields: {
      defaultToReminders: 'Boolean!',
    },
  },
  TiktokPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      isAiGenerated: 'Boolean!',
      title: 'String',
      type: 'PostType!',
    },
  },
  TwitterMetadata: {
    fields: {
      subscriptionType: 'String',
    },
  },
  TwitterPostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      isAiGenerated: 'Boolean!',
      retweet: 'RetweetMetadata',
      thread: '[ThreadedPost!]!',
      threadCount: 'Int!',
      type: 'PostType!',
    },
  },
  TwitterPostMetadataInput: {
    fields: {
      isAiGenerated: 'Boolean',
      retweet: 'RetweetMetadataInput',
      thread: '[ThreadedPostInput!]',
    },
  },
  UserTag: {
    fields: {
      handle: 'String!',
      x: 'Float!',
      y: 'Float!',
    },
  },
  UserTagInput: {
    fields: {
      handle: 'String!',
      x: 'Float!',
      y: 'Float!',
    },
  },
  VideoAsset: {
    fields: {
      id: 'ID',
      mimeType: 'String!',
      source: 'String!',
      thumbnail: 'String!',
      type: 'AssetType!',
      video: 'VideoMetadata!',
    },
  },
  VideoAssetInput: {
    fields: {
      metadata: 'VideoMetadataInput',
      thumbnailUrl: 'String',
      url: 'String!',
    },
  },
  VideoMetadata: {
    fields: {
      audioCodec: 'String',
      containerFormat: 'String',
      durationMs: 'Int!',
      fileSize: 'Int',
      frameRate: 'Int',
      height: 'Int!',
      isTranscodingRequired: 'Boolean!',
      isVideoProcessing: 'Boolean!',
      rotationDegree: 'Int',
      thumbnailOffset: 'Int',
      title: 'String',
      videoBitRate: 'Int',
      videoCodec: 'String',
      width: 'Int!',
    },
  },
  VideoMetadataInput: {
    fields: {
      thumbnailOffset: 'Int',
      title: 'String',
    },
  },
  WeeklyPostingLimit: {
    fields: {
      limit: 'Int!',
      scheduled: 'Int!',
      sent: 'Int!',
    },
  },
  WhatsAppMetadata: {
    fields: {
      businessPortfolioId: 'String!',
      lastSubscribedAt: 'DateTime',
      phoneNumberId: 'String!',
      wabaId: 'String!',
    },
  },
  YoutubeCategory: {
    fields: {
      categoryId: 'String!',
      title: 'String!',
    },
  },
  YoutubeLicense: {
    values: ['creativeCommon', 'youtube'],
  },
  YoutubeMetadata: {
    fields: {
      defaultToReminders: 'Boolean!',
    },
  },
  YoutubePostMetadata: {
    fields: {
      annotations: '[Annotation!]!',
      category: 'YoutubeCategory',
      embeddable: 'Boolean!',
      isAiGenerated: 'Boolean!',
      license: 'YoutubeLicense',
      madeForKids: 'Boolean!',
      notifySubscribers: 'Boolean!',
      privacy: 'YoutubePrivacy',
      title: 'String',
      type: 'PostType!',
    },
  },
  YoutubePostMetadataInput: {
    fields: {
      categoryId: 'String',
      embeddable: 'Boolean',
      isAiGenerated: 'Boolean',
      license: 'YoutubeLicense',
      madeForKids: 'Boolean',
      notifySubscribers: 'Boolean',
      privacy: 'YoutubePrivacy',
      title: 'String',
    },
    defaults: ['embeddable', 'license', 'madeForKids', 'notifySubscribers', 'privacy'],
  },
  YoutubePrivacy: {
    values: ['private', 'public', 'unlisted'],
  },
}
