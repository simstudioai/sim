import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type {
  PlaneActivity,
  PlaneAttachment,
  PlaneBaseParams,
  PlaneComment,
  PlaneCycle,
  PlaneLabel,
  PlaneLink,
  PlaneModule,
  PlanePagination,
  PlaneProject,
  PlaneSearchResult,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkspaceMember,
} from '@/tools/plane/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

/** Plane Cloud API host. Self-hosted instances serve the same API from their own domain. */
const PLANE_CLOUD_BASE_URL = 'https://api.plane.so'

/** Plane caps cursor pages at 100 items on Plane Cloud. */
const PLANE_MAX_PER_PAGE = 100

/**
 * Normalizes the configured Plane host to its origin-relative root. Accepts a bare host, a URL with
 * a trailing slash, or one that already includes the `/api` or `/api/v1` prefix.
 */
export function normalizePlaneBaseUrl(baseUrl?: string | null): string {
  const trimmed = baseUrl?.trim()
  if (!trimmed) return PLANE_CLOUD_BASE_URL
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '').replace(/\/api(\/v1)?$/i, '')
}

/** Encodes one path segment after trimming copy-paste whitespace. */
export function planePathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

/** Builds an absolute Plane API v1 URL for a path below the API root. */
export function planeApiUrl(baseUrl: string | undefined, path: string): string {
  return `${normalizePlaneBaseUrl(baseUrl)}/api/v1/${path}`
}

/** Builds an absolute URL scoped to a workspace (`/api/v1/workspaces/{slug}/...`). */
export function planeWorkspaceUrl(params: PlaneBaseParams, path: string): string {
  return planeApiUrl(params.baseUrl, `workspaces/${planePathSegment(params.workspaceSlug)}/${path}`)
}

/** Builds an absolute URL scoped to a project (`.../projects/{projectId}/...`). */
export function planeProjectUrl(
  params: PlaneBaseParams & { projectId: string },
  path: string
): string {
  return planeWorkspaceUrl(params, `projects/${planePathSegment(params.projectId)}/${path}`)
}

/** Builds an absolute URL scoped to a work item (`.../work-items/{workItemId}/...`). */
export function planeWorkItemUrl(
  params: PlaneBaseParams & { projectId: string; workItemId: string },
  path: string
): string {
  return planeProjectUrl(params, `work-items/${planePathSegment(params.workItemId)}/${path}`)
}

/** Request headers for Plane's personal access token authentication. */
export function planeHeaders(params: { apiKey: string }): Record<string, string> {
  return {
    'X-API-Key': params.apiKey.trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/** Appends Plane cursor pagination params to a URL. */
export function withPlanePagination(
  url: string,
  params: { perPage?: number | string; cursor?: string },
  extra: Record<string, string | undefined> = {}
): string {
  const query = new URLSearchParams()
  const perPage = Number(params.perPage)
  if (params.perPage !== undefined && params.perPage !== '' && Number.isFinite(perPage)) {
    query.set('per_page', String(Math.min(Math.max(Math.trunc(perPage), 1), PLANE_MAX_PER_PAGE)))
  }
  if (params.cursor?.trim()) query.set('cursor', params.cursor.trim())
  for (const [key, value] of Object.entries(extra)) {
    if (value?.trim()) query.set(key, value.trim())
  }
  const qs = query.toString()
  return qs ? `${url}?${qs}` : url
}

/**
 * Normalizes an ID list given as an array, a JSON array string, or a comma-separated string.
 * Returns `undefined` when the input was not provided so callers can omit the field.
 */
export function parsePlaneIdList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean)
    } catch {}
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Returns a trimmed string or `undefined` when empty, for optional request fields. */
export function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Reads the filename from a `Content-Disposition` header. Plane's signed download URLs use the
 * RFC 5987 `filename*=UTF-8''<percent-encoded>` form; the plain `filename=` form is the fallback.
 */
export function parsePlaneContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const extended = header.match(/filename\*\s*=\s*([^;]+)/i)
  if (extended?.[1]) {
    const raw = extended[1].trim().replace(/^"(.*)"$/, '$1')
    const encoded = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw
    try {
      const decoded = decodeURIComponent(encoded)
      if (decoded) return decoded
    } catch {
      if (encoded) return encoded
    }
  }
  const plain = header.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i)
  const name = (plain?.[2] ?? plain?.[1])?.trim()
  return name ? name : null
}

function requireId(value: unknown, entity: string): string {
  const id = toStringOrNull(value)
  if (!id) throw new Error(`Plane ${entity} response is missing its id`)
  return id
}

function stringIds(value: unknown): string[] {
  return toArray(value)
    .map((item) => (typeof item === 'string' ? item : toStringOrNull(toRecord(item).id)))
    .filter((item): item is string => Boolean(item))
}

/** Reads a foreign key that Plane renders as a UUID, or as an object with `id` when expanded. */
function relatedId(value: unknown): string | null {
  if (typeof value === 'string') return value
  return isRecordLike(value) ? toStringOrNull(value.id) : null
}

export function mapPlaneWorkItem(raw: unknown): PlaneWorkItem {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'work item'),
    name: toStringOrNull(data.name) ?? '',
    descriptionHtml: toStringOrNull(data.description_html),
    priority: toStringOrNull(data.priority),
    stateId: relatedId(data.state),
    parentId: relatedId(data.parent),
    estimatePointId: relatedId(data.estimate_point),
    typeId: toStringOrNull(data.type_id) ?? relatedId(data.type),
    sequenceId: toNumberOrNull(data.sequence_id),
    sortOrder: toNumberOrNull(data.sort_order),
    startDate: toStringOrNull(data.start_date),
    targetDate: toStringOrNull(data.target_date),
    completedAt: toStringOrNull(data.completed_at),
    archivedAt: toStringOrNull(data.archived_at),
    isDraft: toBooleanOrNull(data.is_draft),
    assigneeIds: stringIds(data.assignees),
    labelIds: stringIds(data.labels),
    projectId: relatedId(data.project),
    workspaceId: relatedId(data.workspace),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    createdById: relatedId(data.created_by),
    updatedById: relatedId(data.updated_by),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneSearchResult(raw: unknown): PlaneSearchResult {
  const data = toRecord(raw)
  const projectIdentifier = toStringOrNull(data.project__identifier)
  const rawSequence = data.sequence_id
  const sequenceId =
    typeof rawSequence === 'number'
      ? rawSequence
      : typeof rawSequence === 'string' && /^\d+$/.test(rawSequence)
        ? Number(rawSequence)
        : null
  return {
    id: requireId(data.id, 'search result'),
    name: toStringOrNull(data.name) ?? '',
    sequenceId,
    projectIdentifier,
    identifier:
      projectIdentifier && sequenceId !== null ? `${projectIdentifier}-${sequenceId}` : null,
    projectId: toStringOrNull(data.project_id),
    workspaceSlug: toStringOrNull(data.workspace__slug),
  }
}

export function mapPlaneComment(raw: unknown): PlaneComment {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'comment'),
    commentHtml: toStringOrNull(data.comment_html),
    access: toStringOrNull(data.access),
    actorId: relatedId(data.actor),
    workItemId: relatedId(data.issue),
    projectId: relatedId(data.project),
    parentId: relatedId(data.parent),
    isMember: toBooleanOrNull(data.is_member),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    editedAt: toStringOrNull(data.edited_at),
    createdById: relatedId(data.created_by),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneLink(raw: unknown): PlaneLink {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'link'),
    title: toStringOrNull(data.title),
    url: toStringOrNull(data.url),
    workItemId: relatedId(data.issue) ?? toStringOrNull(data.issue_id),
    projectId: relatedId(data.project),
    createdById: relatedId(data.created_by),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneAttachment(raw: unknown): PlaneAttachment {
  const data = toRecord(raw)
  const attributes = toRecord(data.attributes)
  return {
    id: requireId(data.id, 'attachment'),
    name: toStringOrNull(attributes.name),
    type: toStringOrNull(attributes.type),
    size: toNumberOrNull(data.size) ?? toNumberOrNull(attributes.size),
    workItemId: relatedId(data.issue),
    projectId: relatedId(data.project),
    isUploaded: toBooleanOrNull(data.is_uploaded),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    createdById: relatedId(data.created_by),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneProject(raw: unknown): PlaneProject {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'project'),
    name: toStringOrNull(data.name) ?? '',
    identifier: toStringOrNull(data.identifier),
    description: toStringOrNull(data.description),
    network: toNumberOrNull(data.network),
    emoji: toStringOrNull(data.emoji),
    projectLeadId: relatedId(data.project_lead),
    defaultAssigneeId: relatedId(data.default_assignee),
    defaultStateId: relatedId(data.default_state),
    timezone: toStringOrNull(data.timezone),
    totalMembers: toNumberOrNull(data.total_members),
    totalCycles: toNumberOrNull(data.total_cycles),
    totalModules: toNumberOrNull(data.total_modules),
    isMember: toBooleanOrNull(data.is_member),
    memberRole: toNumberOrNull(data.member_role),
    cycleView: toBooleanOrNull(data.cycle_view),
    moduleView: toBooleanOrNull(data.module_view),
    issueViewsView: toBooleanOrNull(data.issue_views_view),
    pageView: toBooleanOrNull(data.page_view),
    intakeView: toBooleanOrNull(data.intake_view),
    archivedAt: toStringOrNull(data.archived_at),
    workspaceId: relatedId(data.workspace),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneState(raw: unknown): PlaneState {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'state'),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    color: toStringOrNull(data.color),
    group: toStringOrNull(data.group),
    sequence: toNumberOrNull(data.sequence),
    isDefault: toBooleanOrNull(data.default),
    isTriage: toBooleanOrNull(data.is_triage),
    projectId: relatedId(data.project),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
  }
}

export function mapPlaneLabel(raw: unknown): PlaneLabel {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'label'),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    color: toStringOrNull(data.color),
    parentId: relatedId(data.parent),
    sortOrder: toNumberOrNull(data.sort_order),
    projectId: relatedId(data.project),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
  }
}

export function mapPlaneUser(raw: unknown): PlaneUser {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'user'),
    firstName: toStringOrNull(data.first_name),
    lastName: toStringOrNull(data.last_name),
    displayName: toStringOrNull(data.display_name),
    email: toStringOrNull(data.email),
    avatar: toStringOrNull(data.avatar),
    avatarUrl: toStringOrNull(data.avatar_url),
  }
}

export function mapPlaneWorkspaceMember(raw: unknown): PlaneWorkspaceMember {
  return { ...mapPlaneUser(raw), role: toNumberOrNull(toRecord(raw).role) }
}

export function mapPlaneCycle(raw: unknown): PlaneCycle {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'cycle'),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    startDate: toStringOrNull(data.start_date),
    endDate: toStringOrNull(data.end_date),
    ownedById: relatedId(data.owned_by),
    timezone: toStringOrNull(data.timezone),
    archivedAt: toStringOrNull(data.archived_at),
    totalIssues: toNumberOrNull(data.total_issues),
    completedIssues: toNumberOrNull(data.completed_issues),
    startedIssues: toNumberOrNull(data.started_issues),
    unstartedIssues: toNumberOrNull(data.unstarted_issues),
    backlogIssues: toNumberOrNull(data.backlog_issues),
    cancelledIssues: toNumberOrNull(data.cancelled_issues),
    projectId: relatedId(data.project),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneModule(raw: unknown): PlaneModule {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'module'),
    name: toStringOrNull(data.name) ?? '',
    description: toStringOrNull(data.description),
    status: toStringOrNull(data.status),
    startDate: toStringOrNull(data.start_date),
    targetDate: toStringOrNull(data.target_date),
    leadId: relatedId(data.lead),
    memberIds: stringIds(data.members),
    archivedAt: toStringOrNull(data.archived_at),
    totalIssues: toNumberOrNull(data.total_issues),
    completedIssues: toNumberOrNull(data.completed_issues),
    startedIssues: toNumberOrNull(data.started_issues),
    unstartedIssues: toNumberOrNull(data.unstarted_issues),
    backlogIssues: toNumberOrNull(data.backlog_issues),
    cancelledIssues: toNumberOrNull(data.cancelled_issues),
    projectId: relatedId(data.project),
    externalSource: toStringOrNull(data.external_source),
    externalId: toStringOrNull(data.external_id),
    createdAt: toStringOrNull(data.created_at),
    updatedAt: toStringOrNull(data.updated_at),
  }
}

export function mapPlaneActivity(raw: unknown): PlaneActivity {
  const data = toRecord(raw)
  return {
    id: requireId(data.id, 'activity'),
    verb: toStringOrNull(data.verb),
    field: toStringOrNull(data.field),
    oldValue: toStringOrNull(data.old_value),
    newValue: toStringOrNull(data.new_value),
    comment: toStringOrNull(data.comment),
    actorId: relatedId(data.actor),
    workItemId: relatedId(data.issue),
    commentId: relatedId(data.issue_comment),
    oldIdentifier: toStringOrNull(data.old_identifier),
    newIdentifier: toStringOrNull(data.new_identifier),
    createdAt: toStringOrNull(data.created_at),
  }
}

/** Empty-cursor values Plane returns when there is no page in that direction. */
function cursorOrNull(value: unknown, hasResults: boolean): string | null {
  const cursor = toStringOrNull(value)
  return cursor && hasResults ? cursor : null
}

/**
 * Reads Plane's cursor-paginated envelope. Some list endpoints (for example the `current` cycle
 * view) return a bare array instead; that is treated as a single complete page.
 */
export function readPlanePage(data: unknown): { results: unknown[]; pagination: PlanePagination } {
  if (Array.isArray(data)) {
    return {
      results: data,
      pagination: {
        nextCursor: null,
        prevCursor: null,
        nextPageResults: false,
        prevPageResults: false,
        count: data.length,
        totalPages: 1,
        totalResults: data.length,
      },
    }
  }
  const record = toRecord(data)
  const nextPageResults = record.next_page_results === true
  const prevPageResults = record.prev_page_results === true
  return {
    results: toArray(record.results),
    pagination: {
      nextCursor: cursorOrNull(record.next_cursor, nextPageResults),
      prevCursor: cursorOrNull(record.prev_cursor, prevPageResults),
      nextPageResults,
      prevPageResults,
      count: toNumberOrNull(record.count),
      totalPages: toNumberOrNull(record.total_pages),
      totalResults: toNumberOrNull(record.total_results),
    },
  }
}

/** Shared connection params for every workspace-scoped Plane tool. */
export const PLANE_CONNECTION_PARAMS = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Plane personal access token (Profile Settings > Personal Access Tokens)',
  },
  workspaceSlug: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Workspace slug from the Plane URL (e.g., "my-team" in app.plane.so/my-team/)',
  },
  baseUrl: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Plane API host for self-hosted instances (e.g., https://plane.example.com). Defaults to Plane Cloud (https://api.plane.so)',
  },
} satisfies ToolConfig['params']

export const PLANE_PROJECT_ID_PARAM = {
  projectId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Project ID (UUID)',
  },
} satisfies ToolConfig['params']

export const PLANE_WORK_ITEM_ID_PARAM = {
  workItemId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Work item ID (UUID)',
  },
} satisfies ToolConfig['params']

export const PLANE_PAGINATION_PARAMS = {
  perPage: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Number of results per page (1-100, default 100)',
  },
  cursor: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Pagination cursor from a previous response (nextCursor)',
  },
} satisfies ToolConfig['params']

export const PLANE_PAGINATION_OUTPUTS = {
  nextCursor: {
    type: 'string',
    description: 'Cursor for the next page, or null when there are no more results',
    optional: true,
    nullable: true,
  },
  prevCursor: {
    type: 'string',
    description: 'Cursor for the previous page, or null on the first page',
    optional: true,
    nullable: true,
  },
  nextPageResults: { type: 'boolean', description: 'Whether more results exist after this page' },
  prevPageResults: { type: 'boolean', description: 'Whether results exist before this page' },
  count: {
    type: 'number',
    description: 'Number of results on this page',
    optional: true,
    nullable: true,
  },
  totalPages: {
    type: 'number',
    description: 'Total number of pages',
    optional: true,
    nullable: true,
  },
  totalResults: {
    type: 'number',
    description: 'Total number of results across all pages',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

const str = (description: string): OutputProperty => ({ type: 'string', description })
const nullableStr = (description: string): OutputProperty => ({
  type: 'string',
  description,
  nullable: true,
})
const nullableNum = (description: string): OutputProperty => ({
  type: 'number',
  description,
  nullable: true,
})
const nullableBool = (description: string): OutputProperty => ({
  type: 'boolean',
  description,
  nullable: true,
})
const idArray = (description: string): OutputProperty => ({
  type: 'array',
  description,
  items: { type: 'string', description: 'ID (UUID)' },
})

export const PLANE_WORK_ITEM_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Work item ID (UUID)'),
  name: str('Work item title'),
  descriptionHtml: nullableStr('Description as HTML'),
  priority: nullableStr('Priority (urgent, high, medium, low, none)'),
  stateId: nullableStr('State ID'),
  parentId: nullableStr('Parent work item ID'),
  estimatePointId: nullableStr('Estimate point ID'),
  typeId: nullableStr('Work item type ID'),
  sequenceId: nullableNum('Sequence number within the project (the 123 in PROJ-123)'),
  sortOrder: nullableNum('Sort order'),
  startDate: nullableStr('Start date (YYYY-MM-DD)'),
  targetDate: nullableStr('Target (due) date (YYYY-MM-DD)'),
  completedAt: nullableStr('Completion timestamp'),
  archivedAt: nullableStr('Archive date'),
  isDraft: nullableBool('Whether the work item is a draft'),
  assigneeIds: idArray('Assigned user IDs'),
  labelIds: idArray('Label IDs'),
  projectId: nullableStr('Project ID'),
  workspaceId: nullableStr('Workspace ID'),
  externalSource: nullableStr('External system the work item was imported from'),
  externalId: nullableStr('ID of the work item in the external system'),
  createdById: nullableStr('ID of the user who created the work item'),
  updatedById: nullableStr('ID of the user who last updated the work item'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_SEARCH_RESULT_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Work item ID (UUID)'),
  name: str('Work item title'),
  sequenceId: nullableNum('Sequence number within the project'),
  projectIdentifier: nullableStr('Project identifier (e.g., PROJ)'),
  identifier: nullableStr(
    'Human-readable identifier composed from projectIdentifier and sequenceId (e.g., PROJ-123)'
  ),
  projectId: nullableStr('Project ID'),
  workspaceSlug: nullableStr('Workspace slug'),
}

export const PLANE_COMMENT_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Comment ID (UUID)'),
  commentHtml: nullableStr('Comment body as HTML'),
  access: nullableStr('Comment visibility (INTERNAL or EXTERNAL)'),
  actorId: nullableStr('ID of the comment author'),
  workItemId: nullableStr('Work item ID'),
  projectId: nullableStr('Project ID'),
  parentId: nullableStr('Parent comment ID for replies'),
  isMember: nullableBool('Whether the requesting user is a member of the project'),
  externalSource: nullableStr('External system the comment was imported from'),
  externalId: nullableStr('ID of the comment in the external system'),
  editedAt: nullableStr('Last edit timestamp'),
  createdById: nullableStr('ID of the user who created the comment'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_LINK_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Link ID (UUID)'),
  title: nullableStr('Link title'),
  url: nullableStr('Linked URL'),
  workItemId: nullableStr('Work item ID'),
  projectId: nullableStr('Project ID'),
  createdById: nullableStr('ID of the user who added the link'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_ATTACHMENT_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Attachment ID (UUID)'),
  name: nullableStr('File name'),
  type: nullableStr('MIME type'),
  size: nullableNum('File size in bytes'),
  workItemId: nullableStr('Work item ID'),
  projectId: nullableStr('Project ID'),
  isUploaded: nullableBool('Whether the file upload has completed'),
  externalSource: nullableStr('External system the attachment was imported from'),
  externalId: nullableStr('ID of the attachment in the external system'),
  createdById: nullableStr('ID of the user who uploaded the attachment'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_PROJECT_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Project ID (UUID)'),
  name: str('Project name'),
  identifier: nullableStr('Project identifier used as the work item prefix (e.g., PROJ)'),
  description: nullableStr('Project description'),
  network: nullableNum('Project visibility (0 = secret, 2 = public)'),
  emoji: nullableStr('Project emoji'),
  projectLeadId: nullableStr('Project lead user ID'),
  defaultAssigneeId: nullableStr('Default assignee user ID'),
  defaultStateId: nullableStr('Default state ID for new work items'),
  timezone: nullableStr('Project timezone'),
  totalMembers: nullableNum('Number of active project members'),
  totalCycles: nullableNum('Number of cycles'),
  totalModules: nullableNum('Number of modules'),
  isMember: nullableBool('Whether the requesting user is a member of the project'),
  memberRole: nullableNum('Requesting user role (20 = admin, 15 = member, 5 = guest)'),
  cycleView: nullableBool('Whether cycles are enabled'),
  moduleView: nullableBool('Whether modules are enabled'),
  issueViewsView: nullableBool('Whether views are enabled'),
  pageView: nullableBool('Whether pages are enabled'),
  intakeView: nullableBool('Whether intake is enabled'),
  archivedAt: nullableStr('Archive timestamp'),
  workspaceId: nullableStr('Workspace ID'),
  externalSource: nullableStr('External system the project was imported from'),
  externalId: nullableStr('ID of the project in the external system'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_STATE_PROPERTIES: Record<string, OutputProperty> = {
  id: str('State ID (UUID)'),
  name: str('State name'),
  description: nullableStr('State description'),
  color: nullableStr('State color (hex)'),
  group: nullableStr('State group (backlog, unstarted, started, completed, cancelled, triage)'),
  sequence: nullableNum('Display order'),
  isDefault: nullableBool('Whether this is the default state for new work items'),
  isTriage: nullableBool('Whether this is the intake triage state'),
  projectId: nullableStr('Project ID'),
  externalSource: nullableStr('External system the state was imported from'),
  externalId: nullableStr('ID of the state in the external system'),
}

export const PLANE_LABEL_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Label ID (UUID)'),
  name: str('Label name'),
  description: nullableStr('Label description'),
  color: nullableStr('Label color (hex)'),
  parentId: nullableStr('Parent label ID'),
  sortOrder: nullableNum('Sort order'),
  projectId: nullableStr('Project ID'),
  externalSource: nullableStr('External system the label was imported from'),
  externalId: nullableStr('ID of the label in the external system'),
}

export const PLANE_USER_PROPERTIES: Record<string, OutputProperty> = {
  id: str('User ID (UUID)'),
  firstName: nullableStr('First name'),
  lastName: nullableStr('Last name'),
  displayName: nullableStr('Display name'),
  email: nullableStr('Email address'),
  avatar: nullableStr('Avatar URL'),
  avatarUrl: nullableStr('Resolved avatar URL'),
}

export const PLANE_WORKSPACE_MEMBER_PROPERTIES: Record<string, OutputProperty> = {
  ...PLANE_USER_PROPERTIES,
  role: nullableNum('Workspace role (20 = admin, 15 = member, 5 = guest)'),
}

const ISSUE_COUNT_PROPERTIES: Record<string, OutputProperty> = {
  totalIssues: nullableNum('Total number of work items'),
  completedIssues: nullableNum('Number of completed work items'),
  startedIssues: nullableNum('Number of started work items'),
  unstartedIssues: nullableNum('Number of unstarted work items'),
  backlogIssues: nullableNum('Number of backlog work items'),
  cancelledIssues: nullableNum('Number of cancelled work items'),
}

export const PLANE_CYCLE_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Cycle ID (UUID)'),
  name: str('Cycle name'),
  description: nullableStr('Cycle description'),
  startDate: nullableStr('Start timestamp'),
  endDate: nullableStr('End timestamp'),
  ownedById: nullableStr('Cycle owner user ID'),
  timezone: nullableStr('Cycle timezone'),
  archivedAt: nullableStr('Archive timestamp'),
  ...ISSUE_COUNT_PROPERTIES,
  projectId: nullableStr('Project ID'),
  externalSource: nullableStr('External system the cycle was imported from'),
  externalId: nullableStr('ID of the cycle in the external system'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_MODULE_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Module ID (UUID)'),
  name: str('Module name'),
  description: nullableStr('Module description'),
  status: nullableStr(
    'Module status (backlog, planned, in-progress, paused, completed, cancelled)'
  ),
  startDate: nullableStr('Start date (YYYY-MM-DD)'),
  targetDate: nullableStr('Target date (YYYY-MM-DD)'),
  leadId: nullableStr('Module lead user ID'),
  memberIds: idArray('Module member user IDs'),
  archivedAt: nullableStr('Archive timestamp'),
  ...ISSUE_COUNT_PROPERTIES,
  projectId: nullableStr('Project ID'),
  externalSource: nullableStr('External system the module was imported from'),
  externalId: nullableStr('ID of the module in the external system'),
  createdAt: nullableStr('Creation timestamp'),
  updatedAt: nullableStr('Last update timestamp'),
}

export const PLANE_ACTIVITY_PROPERTIES: Record<string, OutputProperty> = {
  id: str('Activity ID (UUID)'),
  verb: nullableStr('Action performed (e.g., created, updated, deleted)'),
  field: nullableStr('Field that changed'),
  oldValue: nullableStr('Previous value'),
  newValue: nullableStr('New value'),
  comment: nullableStr('Human-readable summary of the change'),
  actorId: nullableStr('ID of the user who made the change'),
  workItemId: nullableStr('Work item ID'),
  commentId: nullableStr('Related comment ID'),
  oldIdentifier: nullableStr('Previous related object ID'),
  newIdentifier: nullableStr('New related object ID'),
  createdAt: nullableStr('Timestamp of the change'),
}
