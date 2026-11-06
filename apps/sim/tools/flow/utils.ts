import { isRecordLike } from '@sim/utils/object'
import type { HttpRedirectPolicy } from '@/lib/core/security/http-redirect-policy'
import type {
  FlowBranch,
  FlowCategory,
  FlowComment,
  FlowEntity,
  FlowHistoryEntry,
  FlowProject,
  FlowSearchResult,
} from '@/lib/flow'
import { normalizeFlowOrigin } from '@/lib/flow/client'
import type { FlowAuthParams } from '@/tools/flow/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const FLOW_AUTH_PARAMS = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Personal API key resolved from the selected Flow credential',
  },
  domain: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Flow API origin bound to the selected credential',
  },
  providerWorkspaceId: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Flow workspace identifier bound to the selected credential',
  },
} as const satisfies ToolConfig['params']

export const FLOW_OAUTH = {
  required: true,
  provider: 'flow',
  credentialKind: 'service-account',
  authoritativeParams: ['domain', 'providerWorkspaceId'],
} as const

export const FLOW_REDIRECT_POLICY = {
  mode: 'standard',
  sendCredentialsOnCrossOriginRedirect: false,
  sensitiveHeaders: ['x-api-key', 'customer'],
} as const satisfies HttpRedirectPolicy

/** Builds only provider-owned paths with encoded resource IDs and explicit query parameters. */
export function flowUrl(
  params: FlowAuthParams,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): string {
  const url = new URL(`${normalizeFlowOrigin(params.domain)}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function flowLimit(value: number | undefined, maximum: number, fallback: number): number {
  const limit = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`Limit must be an integer between 1 and ${maximum}`)
  }
  return limit
}

export function flowSearchQuery(value: string): string {
  if (typeof value !== 'string' || value.length > 1024)
    throw new Error('Query must contain at most 1024 characters')
  return value
}

export function flowIds(value: string, maximum = 100): string[] {
  const ids = value.split(',').map((id) => id.trim())
  if (ids.length > maximum) throw new Error(`Provide between 1 and ${maximum} entity IDs`)
  for (const id of ids) safeUrlPathSegment(id, 'entityIds')
  return ids
}

function parseFlowJson(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
}

function flowBatch(value: unknown, name: string): Record<string, unknown>[] {
  const items = parseFlowJson(value, name)
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 100 ||
    !items.every(isRecordLike)
  ) {
    throw new Error(`${name} must be a JSON array containing 1 to 100 objects`)
  }
  return items
}

export function flowEntityBatch(value: unknown) {
  return flowBatch(value, 'entities').map((item) => {
    if (
      typeof item.entityType !== 'string' ||
      !item.entityType.trim() ||
      typeof item.name !== 'string'
    ) {
      throw new Error('Each entity requires entityType and name')
    }
    if (item.id !== undefined && typeof item.id !== 'string')
      throw new Error('Entity id must be a string')
    return { entityType: item.entityType.trim(), name: item.name, id: item.id }
  })
}

export function flowValueBatch(value: unknown) {
  return flowBatch(value, 'updates').map((item) => {
    if (
      typeof item.entityId !== 'string' ||
      !item.entityId.trim() ||
      typeof item.key !== 'string' ||
      !item.key.trim() ||
      !Object.hasOwn(item, 'value')
    ) {
      throw new Error('Each update requires entityId, key, and value')
    }
    return { entityId: item.entityId.trim(), key: item.key.trim(), value: item.value }
  })
}

export function flowFilter(value: unknown): Record<string, unknown> {
  const filter = parseFlowJson(value, 'filter')
  if (!isRecordLike(filter)) throw new Error('Filter must be a JSON object')
  return filter
}

export function flowCommentUpdate(params: { text?: string; resolved?: boolean }) {
  if (params.text === undefined && params.resolved === undefined)
    throw new Error('Provide comment text or a resolved status')
  return { text: params.text, resolved: params.resolved }
}

/** The executor caps provider JSON responses before transformation; no tool follows pages implicitly. */
export function assertFlowResponse(response: Response): void {
  if (!response.ok) throw new Error(`Flow request failed with HTTP ${response.status}`)
}

export function mapFlowProject(value: FlowProject) {
  return {
    ai_model: value.ai_model,
    created_at: value.created_at,
    id: value.id,
    name: value.name,
    slug: value.slug,
  }
}

export const FLOW_PROJECT_PROPERTIES = {
  ai_model: {
    type: 'string',
  },
  created_at: {
    type: 'string',
  },
  id: {
    type: 'string',
  },
  name: {
    type: 'string',
  },
  slug: {
    type: 'string',
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowCategory(value: FlowCategory) {
  return {
    builtin: value.builtin,
    categoryType: value.categoryType,
    fields: value.fields,
    humanIdPrefix: value.humanIdPrefix,
    humanIdPrefixLocked: value.humanIdPrefixLocked,
    id: value.id,
    name: value.name,
  }
}

export const FLOW_CATEGORY_PROPERTIES = {
  builtin: {
    type: 'boolean',
  },
  categoryType: {
    type: 'string',
  },
  fields: {
    type: 'array',
    items: {
      type: 'json',
      properties: {
        key: {
          type: 'string',
        },
        multi: {
          type: 'boolean',
          optional: true,
        },
        name: {
          type: 'string',
        },
        tags: {
          type: 'array',
          optional: true,
          items: {
            type: 'json',
            properties: {
              id: {
                type: 'string',
                optional: true,
              },
              name: {
                type: 'string',
              },
            },
          },
        },
        type: {
          type: 'string',
        },
      },
    },
  },
  humanIdPrefix: {
    type: 'string',
  },
  humanIdPrefixLocked: {
    type: 'boolean',
  },
  id: {
    type: 'string',
  },
  name: {
    type: 'string',
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowEntity(value: FlowEntity) {
  return {
    branchesChangedIn: value.branchesChangedIn ?? [],
    branchesCreatedIn: value.branchesCreatedIn ?? [],
    createdAt: value.createdAt ?? null,
    defaultSortKey: value.defaultSortKey ?? null,
    deleted: value.deleted ?? null,
    formulaTemplates: value.formulaTemplates,
    formulas: value.formulas,
    id: value.id,
    links: value.links,
    type: value.type ?? null,
    uniqueEntityNumber: value.uniqueEntityNumber ?? null,
    updatedAt: value.updatedAt ?? null,
    values: value.values,
  }
}

export const FLOW_ENTITY_PROPERTIES = {
  branchesChangedIn: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
    },
  },
  branchesCreatedIn: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
    },
  },
  createdAt: {
    type: 'string',
    nullable: true,
  },
  defaultSortKey: {
    type: 'string',
    nullable: true,
  },
  deleted: {
    type: 'boolean',
    nullable: true,
  },
  formulaTemplates: {
    type: 'json',
  },
  formulas: {
    type: 'json',
  },
  id: {
    type: 'string',
  },
  links: {
    type: 'json',
    properties: {
      crosslinks: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      inbound: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      inboundOrder: {
        type: 'json',
      },
      inboundTypes: {
        type: 'json',
        optional: true,
      },
      outbound: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      outboundOrder: {
        type: 'json',
        optional: true,
      },
      outboundTypes: {
        type: 'json',
        optional: true,
      },
      rootPlaced: {
        type: 'boolean',
        optional: true,
      },
    },
  },
  type: {
    type: 'string',
    nullable: true,
  },
  uniqueEntityNumber: {
    type: 'number',
    nullable: true,
  },
  updatedAt: {
    type: 'string',
    nullable: true,
  },
  values: {
    type: 'json',
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowSearchResult(value: FlowSearchResult) {
  return {
    entity_id: value.entity_id,
    entity_type: value.entity_type,
    human_id: value.human_id ?? null,
    legacy_human_id: value.legacy_human_id ?? null,
    match: value.match ?? null,
    name: value.name,
    same_text_count: value.same_text_count ?? null,
  }
}

export const FLOW_SEARCH_RESULT_PROPERTIES = {
  entity_id: {
    type: 'string',
  },
  entity_type: {
    type: 'string',
  },
  human_id: {
    type: 'string',
    nullable: true,
  },
  legacy_human_id: {
    type: 'string',
    nullable: true,
  },
  match: {
    type: 'string',
    nullable: true,
  },
  name: {
    type: 'string',
  },
  same_text_count: {
    type: 'number',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowBranch(value: FlowBranch) {
  return {
    created_at: value.created_at,
    description: value.description,
    id: value.id,
    is_deleted: value.is_deleted,
    is_protected: value.is_protected,
    live_edits_allowed: value.live_edits_allowed,
    merged_at: value.merged_at ?? null,
    name: value.name,
    number: value.number,
    owner_id: value.owner_id ?? null,
    parent: value.parent ?? null,
    parent_name: value.parent_name ?? null,
    ready_for_review: value.ready_for_review,
    require_review: value.require_review,
    required_reviewer_ids: value.required_reviewer_ids,
    updated_at: value.updated_at,
  }
}

export const FLOW_BRANCH_PROPERTIES = {
  created_at: {
    type: 'string',
  },
  description: {
    type: 'string',
  },
  id: {
    type: 'string',
  },
  is_deleted: {
    type: 'boolean',
  },
  is_protected: {
    type: 'boolean',
  },
  live_edits_allowed: {
    type: 'boolean',
  },
  merged_at: {
    type: 'string',
    nullable: true,
  },
  name: {
    type: 'string',
  },
  number: {
    type: 'number',
  },
  owner_id: {
    type: 'string',
    nullable: true,
  },
  parent: {
    type: 'string',
    nullable: true,
  },
  parent_name: {
    type: 'string',
    nullable: true,
  },
  ready_for_review: {
    type: 'boolean',
  },
  require_review: {
    type: 'boolean',
  },
  required_reviewer_ids: {
    type: 'array',
    items: {
      type: 'string',
    },
  },
  updated_at: {
    type: 'string',
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowComment(value: FlowComment) {
  return {
    author_id: value.author_id,
    branch_id: value.branch_id ?? null,
    created_at: value.created_at,
    entity_id: value.entity_id,
    id: value.id,
    resolved: value.resolved,
    text: value.text,
  }
}

export const FLOW_COMMENT_PROPERTIES = {
  author_id: {
    type: 'string',
    description: 'ID of the user who authored the comment.',
  },
  branch_id: {
    type: 'string',
    description: 'Branch the comment was posted on; null for the main line.',
    nullable: true,
  },
  created_at: {
    type: 'string',
  },
  entity_id: {
    type: 'string',
    description:
      'ID this comment directly attaches to: an item or branch ID for a conversation starter, or a comment ID for a reply (normally the original comment that started the conversation). Use this value as entityId when fetching, editing or deleting this comment. For older nested replies it may identify another reply, not the conversation starter.',
  },
  id: {
    type: 'string',
  },
  resolved: {
    type: 'boolean',
    description: 'Whether the comment thread has been resolved.',
  },
  text: {
    type: 'string',
    description: 'Plain-text body of the comment.',
  },
} as const satisfies Record<string, OutputProperty>

export function mapFlowHistoryEntry(value: FlowHistoryEntry) {
  return {
    actor: value.actor,
    branch_id: value.branch_id,
    change: value.change,
    id: value.id,
    reason: value.reason ?? null,
    timestamp: value.timestamp,
  }
}

export const FLOW_HISTORY_ENTRY_PROPERTIES = {
  actor: {
    type: 'json',
    properties: {
      id: {
        type: 'string',
        description: 'User or agent ID. Omitted for system and unknown actors.',
        optional: true,
      },
      type: {
        type: 'string',
      },
    },
  },
  branch_id: {
    type: 'string',
    description: 'Branch that authored this event; "master" means Base.',
  },
  change: {
    type: 'json',
    properties: {
      entity_id: {
        type: 'string',
        optional: true,
      },
      entity_type: {
        type: 'string',
        optional: true,
      },
      type: {
        type: 'string',
        optional: true,
      },
      field_key: {
        type: 'string',
        optional: true,
      },
      value: {
        type: 'json',
        optional: true,
        nullable: true,
        properties: {},
      },
      formula: {
        type: 'string',
        optional: true,
        nullable: true,
      },
      child_entity_id: {
        type: 'string',
        optional: true,
      },
      parent_entity_id: {
        type: 'string',
        optional: true,
      },
      entity_ids: {
        type: 'array',
        description: 'The two peer entity IDs for this unordered cross-link.',
        optional: true,
        items: {
          type: 'string',
        },
      },
      action: {
        type: 'string',
        optional: true,
      },
      note: {
        type: 'string',
        optional: true,
      },
      source_entity_id: {
        type: 'string',
        optional: true,
      },
      source_name: {
        type: 'string',
        optional: true,
      },
    },
  },
  id: {
    type: 'string',
    description: 'Stable event ID for deduplication.',
  },
  reason: {
    type: 'json',
    nullable: true,
    properties: {
      source_entity_id: {
        type: 'string',
        optional: true,
      },
      source_field_key: {
        type: 'string',
        optional: true,
      },
      type: {
        type: 'string',
        optional: true,
      },
      field_name: {
        type: 'string',
        optional: true,
      },
      next_type: {
        type: 'string',
        optional: true,
      },
      previous_type: {
        type: 'string',
        optional: true,
      },
    },
  },
  timestamp: {
    type: 'string',
  },
} as const satisfies Record<string, OutputProperty>
