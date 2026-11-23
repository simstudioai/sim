import { createLogger } from '@sim/logger'
import { resolveAtlassianCloudId } from '@/lib/atlassian/discovery'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import {
  AttachmentDownloadBudget,
  rethrowAttachmentDownloadError,
} from '@/lib/uploads/utils/attachment-download-budget'

const logger = createLogger('JiraUtils')

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/**
 * Converts a value to ADF format. If the value is already an ADF document object,
 * it is returned as-is. If it is a plain string, it is wrapped in a single-paragraph ADF doc.
 */
export function toAdf(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value === 'object') {
    if (value.type === 'doc') {
      return value
    }
    if (value.type && Array.isArray(value.content)) {
      return { type: 'doc', version: 1, content: [value] }
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && parsed.type === 'doc') {
        return parsed
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        parsed.type &&
        Array.isArray(parsed.content)
      ) {
        return { type: 'doc', version: 1, content: [parsed] }
      }
    } catch {
      // Not JSON — treat as plain text below
    }
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
        ],
      },
    ],
  }
}

/**
 * ADF inline node types, per the "Inline nodes" list in Atlassian's Atlassian
 * Document Format structure reference: "The inline nodes include: date, emoji,
 * hardBreak, inlineCard, mention, status, text, mediaInline".
 *
 * Every other node type is block-level (a top-level or child block node) and is
 * separated by a newline so paragraph, list, and table structure survives text
 * extraction. Treating unknown types as block-level is the safe default: it keeps
 * distinct blocks on distinct lines rather than running them together.
 */
const ADF_INLINE_NODE_TYPES = new Set([
  'date',
  'emoji',
  'hardBreak',
  'inlineCard',
  'mention',
  'status',
  'text',
  'mediaInline',
])

function isInlineAdfNode(node: unknown): boolean {
  if (typeof node === 'string') return true
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  const { type } = node as { type?: unknown }
  return typeof type === 'string' && ADF_INLINE_NODE_TYPES.has(type)
}

/**
 * Joins extracted sibling nodes: inline siblings are concatenated with no
 * separator (ADF `text` nodes carry their own surrounding whitespace), while any
 * boundary touching a block-level node gets a newline.
 */
function joinAdfNodes(nodes: readonly unknown[]): string {
  let out = ''
  let started = false
  let previousWasBlock = false

  for (const node of nodes) {
    const extracted = extractAdfText(node)
    if (!extracted) continue
    const isBlock = !isInlineAdfNode(node)
    if (started && (isBlock || previousWasBlock)) out += '\n'
    out += String(extracted)
    started = true
    previousWasBlock = isBlock
  }

  return out
}

/**
 * Extracts plain text from Atlassian Document Format (ADF) content.
 * Returns null if content is falsy. Tolerates malformed/partial nodes and never
 * throws — it is called from Jira tools, the Jira connector, and the JSM connector.
 */
export function extractAdfText(content: any): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return joinAdfNodes(content)
  if (typeof content !== 'object') return ''

  if (content.type === 'text') return content.text || ''
  if (content.type === 'hardBreak') return '\n'
  if (content.type === 'mention') return content.attrs?.text || ''
  if (content.type === 'emoji') return content.attrs?.shortName || content.attrs?.text || ''
  /** `status`: "attrs.text | Required ✔ | string". */
  if (content.type === 'status') return content.attrs?.text || ''
  /**
   * `date`: "attrs.timestamp | Required ✔ | string". The spec documents neither
   * the units nor the epoch, so the raw value is emitted rather than formatted.
   */
  if (content.type === 'date') {
    const timestamp = content.attrs?.timestamp
    return typeof timestamp === 'string' || typeof timestamp === 'number' ? String(timestamp) : ''
  }
  /**
   * `inlineCard`: "attrs.url | object | A URI". `attrs.data` is only specified as
   * a "JSONLD representation of the link" with no documented field names, so only
   * the URL form is extracted.
   */
  if (content.type === 'inlineCard') {
    return typeof content.attrs?.url === 'string' ? content.attrs.url : ''
  }

  if (content.content) {
    const text = extractAdfText(content.content)
    if (!text) return text ?? ''
    /**
     * `listItem` is a child block node of `bulletList`/`orderedList`; prefixing it
     * renders lists as lists, and indenting its continuation lines keeps nested
     * lists visually nested.
     */
    if (content.type === 'listItem') return `- ${text.replace(/\n/g, '\n  ')}`
    return text
  }

  return ''
}

/**
 * Transforms a raw Jira API user object into a typed user output.
 * Returns null if user data is falsy.
 */
export function transformUser(user: any): {
  accountId: string
  displayName: string
  active: boolean | null
  emailAddress: string | null
  avatarUrl: string | null
  accountType: string | null
  timeZone: string | null
} | null {
  if (!user) return null
  return {
    accountId: user.accountId ?? '',
    displayName: user.displayName ?? '',
    active: user.active ?? null,
    emailAddress: user.emailAddress ?? null,
    avatarUrl: user.avatarUrls?.['48x48'] ?? null,
    accountType: user.accountType ?? null,
    timeZone: user.timeZone ?? null,
  }
}

/**
 * Collects every `customfield_*` entry from a Jira issue `fields` object, keeping
 * Jira's raw value so sprint, story points, team, and app fields stay readable.
 */
function extractCustomFields(fields: unknown): Record<string, unknown> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {}
  const custom: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && value !== null && value !== undefined) {
      custom[key] = value
    }
  }
  return custom
}

interface JiraRawNamed {
  id?: string
  name?: string
  description?: string | null
}

interface JiraRawStatus extends JiraRawNamed {
  statusCategory?: {
    id?: number
    key?: string
    name?: string
    colorName?: string
  } | null
}

interface JiraRawIssueType extends JiraRawNamed {
  subtask?: boolean
  iconUrl?: string | null
}

interface JiraRawIssueRef {
  id?: string
  key?: string
  fields?: {
    summary?: string | null
    status?: { name?: string | null } | null
    issuetype?: { name?: string | null } | null
  } | null
}

interface JiraRawComment {
  id?: string
  body?: unknown
  author?: unknown
  updateAuthor?: unknown
  created?: string
  updated?: string
  visibility?: { type?: string; value?: string } | null
}

interface JiraRawWorklog {
  id?: string
  author?: unknown
  updateAuthor?: unknown
  comment?: unknown
  started?: string
  timeSpent?: string
  timeSpentSeconds?: number
  created?: string
  updated?: string
}

interface JiraRawAttachment {
  id?: string
  filename?: string
  mimeType?: string
  size?: number
  content?: string
  thumbnail?: string | null
  author?: unknown
  created?: string
}

interface JiraRawWatches {
  watchCount?: number
  isWatching?: boolean
  watchers?: unknown
}

interface JiraRawUserName {
  accountId?: string
  displayName?: string
}

interface JiraRawIssueFields {
  [field: string]: unknown
  summary?: string
  description?: unknown
  environment?: unknown
  status?: JiraRawStatus | null
  issuetype?: JiraRawIssueType | null
  project?: { id?: string; key?: string; name?: string; projectTypeKey?: string | null } | null
  priority?: { id?: string; name?: string; iconUrl?: string | null } | null
  assignee?: JiraRawUserName | null
  reporter?: unknown
  creator?: unknown
  labels?: string[]
  components?: JiraRawNamed[]
  fixVersions?: Array<{
    id?: string
    name?: string
    released?: boolean | null
    releaseDate?: string | null
  }>
  resolution?: JiraRawNamed | null
  duedate?: string | null
  created?: string
  updated?: string
  resolutiondate?: string | null
  timetracking?: {
    originalEstimate?: string | null
    remainingEstimate?: string | null
    timeSpent?: string | null
    originalEstimateSeconds?: number | null
    remainingEstimateSeconds?: number | null
    timeSpentSeconds?: number | null
  } | null
  parent?: JiraRawIssueRef | null
  issuelinks?: Array<{
    id?: string
    type?: { id?: string; name?: string; inward?: string; outward?: string } | null
    inwardIssue?: JiraRawIssueRef | null
    outwardIssue?: JiraRawIssueRef | null
  }>
  subtasks?: JiraRawIssueRef[]
  votes?: { votes?: number; hasVoted?: boolean } | null
  watches?: JiraRawWatches | null
  watcher?: JiraRawWatches | null
  comment?: { comments?: JiraRawComment[] } | JiraRawComment[] | null
  worklog?: { worklogs?: JiraRawWorklog[] } | JiraRawWorklog[] | null
  attachment?: JiraRawAttachment[]
}

/** The subset of a Jira REST v3 issue payload that {@link transformIssueData} reads. */
interface JiraRawIssue {
  id?: string
  key?: string
  self?: string
  fields?: JiraRawIssueFields | null
  renderedFields?: { description?: string | null } | null
  names?: Record<string, string> | null
}

/** Reads a paginated Jira container (`{ comments: [...] }`) or a bare array as a list. */
function pagedList<T>(
  value: T[] | Record<string, T[] | undefined> | null | undefined,
  key: string
): T[] {
  if (Array.isArray(value)) return value
  const nested = value?.[key]
  return Array.isArray(nested) ? nested : []
}

function displayNameOf(user: unknown): string {
  const named = (user ?? {}) as JiraRawUserName
  return named.displayName ?? named.accountId ?? 'Unknown'
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function transformIssueRef(ref: JiraRawIssueRef) {
  return {
    id: ref.id ?? '',
    key: ref.key ?? '',
    statusName: ref.fields?.status?.name ?? null,
    summary: ref.fields?.summary ?? null,
  }
}

/**
 * Transforms a raw Jira REST v3 issue (as returned by `GET /issue/{key}` or a JQL search
 * item) into the typed issue output shared by the retrieve and search tools.
 */
export function transformIssueData(data: JiraRawIssue | null | undefined) {
  const fields: JiraRawIssueFields = data?.fields ?? {}
  const watches = fields.watches ?? fields.watcher
  return {
    id: data?.id ?? '',
    issueKey: data?.key ?? '',
    key: data?.key ?? '',
    self: data?.self ?? '',
    summary: fields.summary ?? '',
    description: extractAdfText(fields.description),
    descriptionAdf: fields.description ?? null,
    renderedDescription: data?.renderedFields?.description ?? null,
    environment: extractAdfText(fields.environment),
    status: {
      id: fields.status?.id ?? '',
      name: fields.status?.name ?? '',
      description: fields.status?.description ?? null,
      statusCategory: fields.status?.statusCategory
        ? {
            id: fields.status.statusCategory.id,
            key: fields.status.statusCategory.key ?? '',
            name: fields.status.statusCategory.name ?? '',
            colorName: fields.status.statusCategory.colorName ?? '',
          }
        : undefined,
    },
    issuetype: {
      id: fields.issuetype?.id ?? '',
      name: fields.issuetype?.name ?? '',
      description: fields.issuetype?.description ?? null,
      subtask: fields.issuetype?.subtask ?? false,
      iconUrl: fields.issuetype?.iconUrl ?? null,
    },
    project: {
      id: fields.project?.id ?? '',
      key: fields.project?.key ?? '',
      name: fields.project?.name ?? '',
      projectTypeKey: fields.project?.projectTypeKey ?? null,
    },
    priority: fields.priority
      ? {
          id: fields.priority.id ?? '',
          name: fields.priority.name ?? '',
          iconUrl: fields.priority.iconUrl ?? null,
        }
      : null,
    statusName: fields.status?.name ?? '',
    assignee: transformUser(fields.assignee),
    assigneeName: fields.assignee?.displayName ?? fields.assignee?.accountId ?? null,
    reporter: transformUser(fields.reporter),
    creator: transformUser(fields.creator),
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((c) => ({
      id: c.id ?? '',
      name: c.name ?? '',
      description: c.description ?? null,
    })),
    fixVersions: (fields.fixVersions ?? []).map((v) => ({
      id: v.id ?? '',
      name: v.name ?? '',
      released: v.released ?? null,
      releaseDate: v.releaseDate ?? null,
    })),
    resolution: fields.resolution
      ? {
          id: fields.resolution.id ?? '',
          name: fields.resolution.name ?? '',
          description: fields.resolution.description ?? null,
        }
      : null,
    duedate: fields.duedate ?? null,
    created: fields.created ?? '',
    updated: fields.updated ?? '',
    resolutiondate: fields.resolutiondate ?? null,
    timetracking: fields.timetracking
      ? {
          originalEstimate: fields.timetracking.originalEstimate ?? null,
          remainingEstimate: fields.timetracking.remainingEstimate ?? null,
          timeSpent: fields.timetracking.timeSpent ?? null,
          originalEstimateSeconds: fields.timetracking.originalEstimateSeconds ?? null,
          remainingEstimateSeconds: fields.timetracking.remainingEstimateSeconds ?? null,
          timeSpentSeconds: fields.timetracking.timeSpentSeconds ?? null,
        }
      : null,
    parent: fields.parent
      ? {
          id: fields.parent.id ?? '',
          key: fields.parent.key ?? '',
          summary: fields.parent.fields?.summary ?? null,
        }
      : null,
    issuelinks: (fields.issuelinks ?? []).map((link) => ({
      id: link.id ?? '',
      type: {
        id: link.type?.id ?? '',
        name: link.type?.name ?? '',
        inward: link.type?.inward ?? '',
        outward: link.type?.outward ?? '',
      },
      inwardIssue: link.inwardIssue ? transformIssueRef(link.inwardIssue) : null,
      outwardIssue: link.outwardIssue ? transformIssueRef(link.outwardIssue) : null,
    })),
    subtasks: (fields.subtasks ?? []).map((sub) => ({
      id: sub.id ?? '',
      key: sub.key ?? '',
      summary: sub.fields?.summary ?? '',
      statusName: sub.fields?.status?.name ?? '',
      issueTypeName: sub.fields?.issuetype?.name ?? null,
    })),
    votes: fields.votes
      ? {
          votes: fields.votes.votes ?? 0,
          hasVoted: fields.votes.hasVoted ?? false,
        }
      : null,
    watches: watches
      ? {
          watchCount: watches.watchCount ?? 0,
          isWatching: watches.isWatching ?? false,
        }
      : null,
    comments: pagedList(fields.comment, 'comments').map((c) => ({
      id: c.id ?? '',
      body: extractAdfText(c.body) ?? '',
      author: transformUser(c.author),
      authorName: displayNameOf(c.author),
      updateAuthor: transformUser(c.updateAuthor),
      created: c.created ?? '',
      updated: c.updated ?? '',
      visibility: c.visibility
        ? { type: c.visibility.type ?? '', value: c.visibility.value ?? '' }
        : null,
    })),
    worklogs: pagedList(fields.worklog, 'worklogs').map((w) => ({
      id: w.id ?? '',
      author: transformUser(w.author),
      authorName: displayNameOf(w.author),
      updateAuthor: transformUser(w.updateAuthor),
      comment: w.comment ? (extractAdfText(w.comment) ?? null) : null,
      started: w.started ?? '',
      timeSpent: w.timeSpent ?? '',
      timeSpentSeconds: w.timeSpentSeconds ?? 0,
      created: w.created ?? '',
      updated: w.updated ?? '',
    })),
    watchers: Array.isArray(fields.watches?.watchers)
      ? fields.watches.watchers.map(transformUser).filter(isPresent)
      : [],
    customFields: extractCustomFields(fields),
    names: data?.names ?? null,
    attachments: (fields.attachment ?? []).map((att) => ({
      id: att.id ?? '',
      filename: att.filename ?? '',
      mimeType: att.mimeType ?? '',
      size: att.size ?? 0,
      content: att.content ?? '',
      thumbnail: att.thumbnail ?? null,
      author: transformUser(att.author),
      authorName: displayNameOf(att.author),
      created: att.created ?? '',
    })),
  }
}

/**
 * Normalizes a caller-supplied map of Jira field IDs to values. Numeric keys become
 * `customfield_<n>`; a JSON string is parsed. Returns undefined when nothing usable is given.
 */
export function parseJiraFieldMap(value: unknown): Record<string, unknown> | undefined {
  let parsed = value
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()
    if (!trimmed) return undefined
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Fields must be a JSON object mapping field IDs to values')
    }
  }
  if (parsed === null || parsed === undefined) return undefined
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Fields must be a JSON object mapping field IDs to values')
  }
  const result: Record<string, unknown> = {}
  for (const [key, fieldValue] of Object.entries(parsed)) {
    const fieldId = key.trim()
    if (!fieldId) continue
    result[/^\d+$/.test(fieldId) ? `customfield_${fieldId}` : fieldId] = fieldValue
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Downloads Jira attachment file content given attachment metadata and an access token.
 * Returns buffered files within the per-file and shared download limits.
 */
export async function downloadJiraAttachments(
  attachments: Array<{
    content: string
    filename: string
    mimeType: string
    size: number
    id: string
  }>,
  accessToken: string,
  budget = new AttachmentDownloadBudget()
): Promise<Array<{ name: string; mimeType: string; data: Buffer; size: number }>> {
  const downloaded: Array<{ name: string; mimeType: string; data: Buffer; size: number }> = []

  for (const att of attachments) {
    budget.signal?.throwIfAborted()
    if (!att.content) continue
    if (att.size > MAX_ATTACHMENT_SIZE) {
      logger.warn(`Skipping attachment ${att.filename} (${att.size} bytes): exceeds size limit`)
      continue
    }
    try {
      budget.assertSize(att.size, 'Jira attachments', MAX_ATTACHMENT_SIZE)
      const response = await fetchWithRetry(att.content, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: '*/*',
        },
        signal: budget.signal,
      })

      if (!response.ok) {
        await response.body?.cancel()
        budget.signal?.throwIfAborted()
        logger.warn(`Failed to download attachment ${att.filename}: HTTP ${response.status}`)
        continue
      }

      const buffer = await budget.read(response, 'Jira attachments', MAX_ATTACHMENT_SIZE)

      downloaded.push({
        name: att.filename || `attachment-${att.id}`,
        mimeType: att.mimeType || 'application/octet-stream',
        data: buffer,
        size: buffer.length,
      })
    } catch (error) {
      rethrowAttachmentDownloadError(error, budget.signal)
      logger.warn(`Failed to download attachment ${att.filename}:`, error)
    }
  }

  return downloaded
}

/**
 * Normalizes an ISO timestamp into the format Jira's worklog API requires:
 * `YYYY-MM-DDTHH:mm:ss.sss±HHMM` (offset without colon). Accepts trailing `Z`
 * and `±HH:MM` offsets and rewrites them to `±HHMM`. If milliseconds are
 * missing, `.000` is inserted before the offset.
 */
export function normalizeJiraWorklogTimestamp(value: string): string {
  let s = value.trim()
  s = s.replace(/Z$/i, '+0000')
  s = s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2')
  s = s.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{4})$/, '$1.000$2')
  return s
}

/**
 * Resolves the `cloudId` for a Jira site. Memoized per domain by the shared
 * Atlassian resolver, which Confluence and JSM read through as well.
 */
export function getJiraCloudId(
  domain: string,
  accessToken: string,
  retryOptions?: RetryOptions
): Promise<string> {
  return resolveAtlassianCloudId({ domain, accessToken, product: 'Jira', retryOptions })
}

/**
 * Parse error messages from Atlassian API responses (Jira, JSM, Confluence).
 * Handles all known error formats: errorMessage, errorMessages[], errors[].title/detail,
 * field-level errors object, and generic message fallback.
 */
export function parseAtlassianErrorMessage(
  status: number,
  statusText: string,
  errorText: string
): string {
  try {
    const errorData = JSON.parse(errorText)
    if (errorData.errorMessage) {
      return errorData.errorMessage
    }
    if (Array.isArray(errorData.errorMessages) && errorData.errorMessages.length > 0) {
      return errorData.errorMessages.join(', ')
    }
    if (Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const err = errorData.errors[0]
      if (err?.title) {
        return err.detail ? `${err.title}: ${err.detail}` : err.title
      }
    }
    if (errorData.errors && !Array.isArray(errorData.errors)) {
      const fieldErrors = Object.entries(errorData.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ')
      if (fieldErrors) return fieldErrors
    }
    if (errorData.message) {
      return errorData.message
    }
  } catch {
    if (errorText) {
      return errorText
    }
  }
  return `${status} ${statusText}`
}
