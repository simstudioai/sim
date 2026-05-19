import type {
  NewRelicChangeTrackingEvent,
  NewRelicCreateDeploymentEventParams,
  NewRelicCreateDeploymentEventResponse,
  NewRelicDeploymentType,
} from '@/tools/new_relic/types'
import {
  cleanOptionalString,
  getNerdGraphEndpoint,
  gqlString,
  newRelicHeaders,
  parseNerdGraphResponse,
} from '@/tools/new_relic/utils'
import type { ToolConfig } from '@/tools/types'

interface CreateDeploymentEventData {
  changeTrackingCreateEvent?: {
    changeTrackingEvent?: NewRelicChangeTrackingEvent | null
    messages?: string[]
  } | null
}

const DEPLOYMENT_TYPES: NewRelicDeploymentType[] = [
  'basic',
  'blue green',
  'canary',
  'rolling',
  'shadow',
]

const CUSTOM_ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESTRICTED_CUSTOM_ATTRIBUTE_NAMES = new Set([
  'accountId',
  'ago',
  'and',
  'appID',
  'as',
  'auto',
  'begin',
  'begintime',
  'category',
  'categoryType',
  'changeTrackingId',
  'compare',
  'customAttributes',
  'customType',
  'day',
  'days',
  'description',
  'end',
  'endtime',
  'explain',
  'entityGuid',
  'entityName',
  'eventType',
  'facet',
  'from',
  'groupId',
  'hostname',
  'hour',
  'hours',
  'in',
  'is',
  'like',
  'limit',
  'log',
  'minute',
  'minutes',
  'month',
  'months',
  'not',
  'null',
  'offset',
  'or',
  'raw',
  'second',
  'seconds',
  'select',
  'since',
  'timeseries',
  'timestamp',
  'type',
  'until',
  'user',
  'week',
  'weeks',
  'where',
  'with',
])

const getDeploymentType = (value?: string): NewRelicDeploymentType => {
  const normalized = value?.toLowerCase().replace(/[_-]/g, ' ')
  return DEPLOYMENT_TYPES.includes(normalized as NewRelicDeploymentType)
    ? (normalized as NewRelicDeploymentType)
    : 'basic'
}

const graphqlLiteral = (value: string | number | boolean): string => {
  if (typeof value === 'string') return gqlString(value)
  return String(value)
}

const buildCustomAttributes = (
  customAttributes?: NewRelicCreateDeploymentEventParams['customAttributes']
): string | undefined => {
  if (!customAttributes) return undefined

  const entries = Object.entries(customAttributes)
  if (!entries.length) return undefined

  for (const [key, value] of entries) {
    if (!CUSTOM_ATTRIBUTE_NAME_PATTERN.test(key)) {
      throw new Error(
        `Invalid New Relic custom attribute name "${key}". Use letters, numbers, and underscores, and do not start with a number.`
      )
    }
    if (RESTRICTED_CUSTOM_ATTRIBUTE_NAMES.has(key) || key.includes('.')) {
      throw new Error(`New Relic custom attribute name "${key}" is restricted`)
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(
        `Invalid value for New Relic custom attribute "${key}". Use a string, number, or boolean.`
      )
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Invalid numeric value for New Relic custom attribute "${key}"`)
    }
  }

  const fields = entries.map(([key, value]) => `${key}: ${graphqlLiteral(value)}`).join(', ')
  return `customAttributes: { ${fields} }`
}

const buildDeploymentMutation = (params: NewRelicCreateDeploymentEventParams): string => {
  const deploymentType = getDeploymentType(params.deploymentType)
  const entityGuid = params.entityGuid.trim()
  if (!entityGuid || entityGuid.includes("'")) {
    throw new Error('Invalid entity GUID: value must not be empty or contain single quotes')
  }
  const version = params.version.trim()
  const shortDescription = cleanOptionalString(params.shortDescription)
  const description = cleanOptionalString(params.description)
  const changelog = cleanOptionalString(params.changelog)
  const commit = cleanOptionalString(params.commit)
  const deepLink = cleanOptionalString(params.deepLink)
  const user = cleanOptionalString(params.user)
  const groupId = cleanOptionalString(params.groupId)
  const customAttributes = buildCustomAttributes(params.customAttributes)
  const deploymentFields = [
    `version: ${gqlString(version)}`,
    changelog ? `changelog: ${gqlString(changelog)}` : undefined,
    commit ? `commit: ${gqlString(commit)}` : undefined,
    deepLink ? `deepLink: ${gqlString(deepLink)}` : undefined,
  ]
    .filter((field): field is string => Boolean(field))
    .join(', ')
  const optionalFields = [
    shortDescription ? `shortDescription: ${gqlString(shortDescription)}` : undefined,
    description ? `description: ${gqlString(description)}` : undefined,
    user ? `user: ${gqlString(user)}` : undefined,
    groupId ? `groupId: ${gqlString(groupId)}` : undefined,
    customAttributes,
    params.timestamp ? `timestamp: ${Math.trunc(Number(params.timestamp))}` : undefined,
  ]
    .filter((field): field is string => Boolean(field))
    .join('\n          ')

  return `mutation {
  changeTrackingCreateEvent(
    changeTrackingEvent: {
      categoryAndTypeData: {
        categoryFields: { deployment: { ${deploymentFields} } }
        kind: { category: "deployment", type: ${gqlString(deploymentType)} }
      }
      entitySearch: { query: ${gqlString(`id = '${entityGuid}'`)} }
      ${optionalFields}
    }
  ) {
    changeTrackingEvent {
      category
      categoryAndType
      changeTrackingId
      customAttributes
      description
      entity {
        guid
        name
      }
      groupId
      shortDescription
      timestamp
      type
      user
    }
    messages
  }
}`
}

export const newRelicCreateDeploymentEventTool: ToolConfig<
  NewRelicCreateDeploymentEventParams,
  NewRelicCreateDeploymentEventResponse
> = {
  id: 'new_relic_create_deployment_event',
  name: 'New Relic Create Deployment Event',
  description: 'Record a deployment change event in New Relic change tracking.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'New Relic user API key for NerdGraph',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New Relic data center region: us or eu',
    },
    entityGuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the entity associated with the deployment',
    },
    version: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Deployment version, release name, or commit SHA',
    },
    shortDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Short description of the deployment',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Longer deployment description',
    },
    changelog: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deployment changelog text or URL',
    },
    commit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit SHA or identifier associated with the deployment',
    },
    deepLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to the deployment, build, or release details',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User or automation that performed the deployment',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional group ID to correlate related changes',
    },
    customAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom change event metadata as key-value pairs with string, number, or boolean values',
    },
    deploymentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deployment type: basic, blue green, canary, rolling, or shadow',
    },
    timestamp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event timestamp in milliseconds since Unix epoch',
    },
  },

  request: {
    url: (params) => getNerdGraphEndpoint(params.region),
    method: 'POST',
    headers: (params) => newRelicHeaders(params.apiKey),
    body: (params) => ({
      query: buildDeploymentMutation(params),
    }),
  },

  transformResponse: async (response) => {
    const payload = await parseNerdGraphResponse<CreateDeploymentEventData>(response)
    const result = payload.data?.changeTrackingCreateEvent
    if (!result) {
      throw new Error('New Relic did not return a deployment change tracking result')
    }
    if (!result.changeTrackingEvent) {
      const message = result.messages?.length
        ? result.messages.join('; ')
        : 'New Relic did not create a deployment change tracking event'
      throw new Error(message)
    }

    return {
      success: true,
      output: {
        event: result.changeTrackingEvent,
        messages: result?.messages ?? [],
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Created New Relic change tracking event',
      properties: {
        changeTrackingId: {
          type: 'string',
          description: 'New Relic change tracking ID',
          nullable: true,
        },
        customAttributes: {
          type: 'json',
          description: 'Custom attributes on the change tracking event',
          optional: true,
          nullable: true,
        },
        category: { type: 'string', description: 'Change category', nullable: true },
        categoryAndType: {
          type: 'string',
          description: 'Combined category and type',
          nullable: true,
        },
        type: { type: 'string', description: 'Change type', nullable: true },
        shortDescription: {
          type: 'string',
          description: 'Short change description',
          nullable: true,
        },
        description: { type: 'string', description: 'Change description', nullable: true },
        timestamp: {
          type: 'number',
          description: 'Change timestamp in milliseconds',
          nullable: true,
        },
        user: { type: 'string', description: 'User associated with the change', nullable: true },
        groupId: { type: 'string', description: 'Change group ID', nullable: true },
        entity: {
          type: 'object',
          description: 'Entity associated with the change',
          nullable: true,
          properties: {
            guid: { type: 'string', description: 'Entity GUID', nullable: true },
            name: { type: 'string', description: 'Entity name', nullable: true },
          },
        },
      },
    },
    messages: {
      type: 'array',
      description: 'Messages returned by New Relic for the created change event',
      items: {
        type: 'string',
        description: 'New Relic message',
      },
    },
  },
}
