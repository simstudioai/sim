/**
 * Pure parsing for the inline special tags the assistant streams —
 * `<options>`, `<credential>`, `<workspace_resource>`, `<question>`, and the
 * rest — plus every type they resolve to.
 *
 * Split out of the renderer deliberately. The components that DRAW these tags
 * need workspace context (`useParams`, `useUserPermissionsContext`), which a
 * chat rendered on an anonymous share page cannot provide. The parsing needs
 * none of it, so it lives here and both surfaces share one implementation of
 * the wire format.
 */

export interface OptionsItemData {
  title: string
  description: string
}

export type OptionsTagData = Record<string, OptionsItemData>

export const USAGE_UPGRADE_ACTIONS = ['upgrade_plan', 'increase_limit'] as const

export type UsageUpgradeAction = (typeof USAGE_UPGRADE_ACTIONS)[number]

/**
 * Synthetic inline tag payload derived from request-layer HTTP upgrade/quota
 * failures and rendered through the same special-tag abstraction as streamed tags.
 */
export interface UsageUpgradeTagData {
  reason: string
  action: UsageUpgradeAction
  message: string
}

export const CREDENTIAL_TAG_TYPES = [
  'env_key',
  'oauth_key',
  'sim_key',
  'credential_id',
  'link',
  'secret_input',
] as const

export type CredentialTagType = (typeof CREDENTIAL_TAG_TYPES)[number]

export const SECRET_INPUT_SCOPES = ['personal', 'workspace'] as const

export type SecretInputScope = (typeof SECRET_INPUT_SCOPES)[number]

export interface CredentialTagData {
  value?: string
  type: CredentialTagType
  provider?: string
  /**
   * Env-var key name to save the pasted secret under (secret_input only),
   * e.g. "OPENAI_API_KEY".
   */
  name?: string
  /** Where a secret_input value is persisted. Defaults to "workspace". */
  scope?: SecretInputScope
}

export interface MothershipErrorTagData {
  message: string
  code?: string
  provider?: string
}

export interface FileTagData {
  name: string
  type: string
  content: string
}

export const QUESTION_TYPES = ['single_select', 'multi_select'] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export interface QuestionOption {
  id: string
  label: string
}

/**
 * One question in a `<question>` tag: a single_select or multi_select with at
 * least one real option. The card always appends its own free-text "Something
 * else" row, so agent-supplied catch-all options ("Other", "Something else",
 * ...) are stripped during parsing.
 */
export interface QuestionItem {
  type: QuestionType
  prompt: string
  options: QuestionOption[]
}

/** Normalized `<question>` payload: single-object bodies become a one-element array. */
export type QuestionTagData = QuestionItem[]

export const WORKSPACE_RESOURCE_TAG_TYPES = ['workflow', 'table', 'file'] as const

export type WorkspaceResourceTagType = (typeof WORKSPACE_RESOURCE_TAG_TYPES)[number]

export interface WorkspaceResourceTagData {
  type: WorkspaceResourceTagType
  id?: string
  path?: string
  title?: string
}

export type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }

export type RuntimeSpecialTagName =
  | 'thinking'
  | 'options'
  | 'credential'
  | 'mothership-error'
  | 'file'
  | 'workspace_resource'
  | 'question'

export interface ParsedSpecialContent {
  segments: ContentSegment[]
  hasPendingTag: boolean
}

const RUNTIME_SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'credential',
  'mothership-error',
  'file',
  'workspace_resource',
  'question',
] as const

const SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'usage_upgrade',
  'credential',
  'mothership-error',
  'workspace_resource',
  'question',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionsItemData(value: unknown): value is OptionsItemData {
  if (!isRecord(value)) return false
  return typeof value.title === 'string' && typeof value.description === 'string'
}

function isOptionsTagData(value: unknown): value is OptionsTagData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isOptionsItemData)
}

function isUsageUpgradeTagData(value: unknown): value is UsageUpgradeTagData {
  if (!isRecord(value)) return false
  return (
    typeof value.reason === 'string' &&
    typeof value.message === 'string' &&
    typeof value.action === 'string' &&
    (USAGE_UPGRADE_ACTIONS as readonly string[]).includes(value.action)
  )
}

function isCredentialTagData(value: unknown): value is CredentialTagData {
  if (!isRecord(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(CREDENTIAL_TAG_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (value.provider !== undefined && typeof value.provider !== 'string') return false
  // secret_input is an empty input the user fills in — it carries a key name to
  // save under, not a value.
  if (value.type === 'secret_input') {
    if (
      value.scope !== undefined &&
      !(SECRET_INPUT_SCOPES as readonly string[]).includes(value.scope as string)
    ) {
      return false
    }
    return typeof value.name === 'string' && value.name.trim().length > 0
  }
  // A sim_key chip is platform-filled: the model only marks where the workspace
  // API key belongs (it never holds the value) and Sim injects it from the tool
  // result, so the tag is valid with or without a `value`. Every other rendered
  // type (e.g. link) needs a string value to render.
  if (value.type === 'sim_key') return true
  return typeof value.value === 'string'
}

function isMothershipErrorTagData(value: unknown): value is MothershipErrorTagData {
  if (!isRecord(value)) return false
  return (
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string') &&
    (value.provider === undefined || typeof value.provider === 'string')
  )
}

function isWorkspaceResourceTagData(value: unknown): value is WorkspaceResourceTagData {
  if (!isRecord(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(WORKSPACE_RESOURCE_TAG_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  if (value.id !== undefined && typeof value.id !== 'string') return false

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  if (value.type === 'file') return id.length > 0 || path.length > 0
  return id.length > 0
}

function isQuestionOption(value: unknown): value is QuestionOption {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.label === 'string'
}

/**
 * Catch-all labels the agent must not supply as options — the card renders
 * its own free-text "Something else" row. Matching options are stripped; a
 * question left with no real options is invalid.
 */
const SELF_PROVIDED_OPTION_LABELS = new Set([
  'other',
  'others',
  'something else',
  'none of the above',
  'none of these',
])

function isQuestionItem(value: unknown): value is QuestionItem {
  if (!isRecord(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(QUESTION_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) return false
  return (
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every(isQuestionOption)
  )
}

/** Strips agent-supplied catch-all options; null when none remain. */
function sanitizeQuestionItem(item: QuestionItem): QuestionItem | null {
  const options = item.options.filter(
    (option) => !SELF_PROVIDED_OPTION_LABELS.has(option.label.trim().toLowerCase())
  )
  if (options.length === 0) return null
  return options.length === item.options.length ? item : { ...item, options }
}

/**
 * Parses a `<question>` tag body. Accepts a single question object or a
 * non-empty array of them; single objects are normalized to a one-element
 * array so the renderer only handles the array shape.
 */
/**
 * Extracts the last complete `<question>` tag payload from raw message
 * content. Used by the chat list to pair an assistant question card with the
 * user message that answered it.
 */
export function parseLastQuestionTag(content: string): QuestionTagData | null {
  const matches = content.match(/<question>([\s\S]*?)<\/question>/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  return parseQuestionTagBody(last.slice('<question>'.length, -'</question>'.length))
}

export function parseQuestionTagBody(body: string): QuestionTagData | null {
  try {
    const parsed = JSON.parse(body) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    if (items.length === 0 || !items.every(isQuestionItem)) return null
    const sanitized: QuestionItem[] = []
    for (const item of items) {
      const clean = sanitizeQuestionItem(item)
      if (!clean) return null
      sanitized.push(clean)
    }
    return sanitized
  } catch {
    return null
  }
}

export function parseJsonTagBody<T>(
  body: string,
  isExpectedShape: (value: unknown) => value is T
): T | null {
  try {
    const parsed = JSON.parse(body) as unknown
    return isExpectedShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseTextTagBody(body: string): string | null {
  return body.trim() ? body : null
}

export function parseTagAttributes(openTag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_:-]*)="([^"]*)"/g

  let match: RegExpExecArray | null = null
  while ((match = attributePattern.exec(openTag)) !== null) {
    attributes[match[1]] = match[2]
  }

  return attributes
}

export function parseFileTag(openTag: string, body: string): FileTagData | null {
  const attributes = parseTagAttributes(openTag)
  if (!attributes.name || !attributes.type) return null
  return {
    name: attributes.name,
    type: attributes.type,
    content: body,
  }
}

function parseSpecialTagData(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
):
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }
  | null {
  if (tagName === 'thinking') {
    const content = parseTextTagBody(body)
    return content ? { type: 'thinking', content } : null
  }

  if (tagName === 'options') {
    const data = parseJsonTagBody(body, isOptionsTagData)
    return data ? { type: 'options', data } : null
  }

  if (tagName === 'usage_upgrade') {
    const data = parseJsonTagBody(body, isUsageUpgradeTagData)
    return data ? { type: 'usage_upgrade', data } : null
  }

  if (tagName === 'credential') {
    const data = parseJsonTagBody(body, isCredentialTagData)
    return data ? { type: 'credential', data } : null
  }

  if (tagName === 'mothership-error') {
    const data = parseJsonTagBody(body, isMothershipErrorTagData)
    return data ? { type: 'mothership-error', data } : null
  }

  if (tagName === 'workspace_resource') {
    const data = parseJsonTagBody(body, isWorkspaceResourceTagData)
    return data ? { type: 'workspace_resource', data } : null
  }

  if (tagName === 'question') {
    const data = parseQuestionTagBody(body)
    return data ? { type: 'question', data } : null
  }

  return null
}

/**
 * Parses inline special tags (`<options>`, `<usage_upgrade>`, `<workspace_resource>`) from streamed
 * text content. Complete tags are extracted into typed segments; incomplete
 * tags (still streaming) are suppressed from display and flagged via
 * `hasPendingTag` so the caller can show a loading indicator.
 *
 * Trailing partial opening tags (e.g. `<opt`, `<usage_`) are also stripped
 * during streaming to prevent flashing raw markup.
 */
export function parseSpecialTags(content: string, isStreaming: boolean): ParsedSpecialContent {
  const segments: ContentSegment[] = []
  let hasPendingTag = false
  let cursor = 0

  while (cursor < content.length) {
    let nearestStart = -1
    let nearestTagName: (typeof SPECIAL_TAG_NAMES)[number] | '' = ''

    for (const name of SPECIAL_TAG_NAMES) {
      const idx = content.indexOf(`<${name}>`, cursor)
      if (idx !== -1 && (nearestStart === -1 || idx < nearestStart)) {
        nearestStart = idx
        nearestTagName = name
      }
    }

    if (nearestStart === -1) {
      let remaining = content.slice(cursor)

      if (isStreaming) {
        const partial = remaining.match(/<[a-z_-]*$/i)
        if (partial) {
          const fragment = partial[0].slice(1)
          if (
            fragment.length > 0 &&
            [...SPECIAL_TAG_NAMES, ...RUNTIME_SPECIAL_TAG_NAMES].some((t) => t.startsWith(fragment))
          ) {
            remaining = remaining.slice(0, -partial[0].length)
            hasPendingTag = true
          }
        }
      }

      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    if (nearestStart > cursor) {
      const text = content.slice(cursor, nearestStart)
      if (text.trim()) {
        segments.push({ type: 'text', content: text })
      }
    }

    const openTag = `<${nearestTagName}>`
    const closeTag = `</${nearestTagName}>`
    const bodyStart = nearestStart + openTag.length
    const closeIdx = content.indexOf(closeTag, bodyStart)

    if (closeIdx === -1) {
      hasPendingTag = true
      cursor = content.length
      break
    }

    const body = content.slice(bodyStart, closeIdx)
    if (!nearestTagName) {
      cursor = closeIdx + closeTag.length
      continue
    }
    const parsedTag = parseSpecialTagData(nearestTagName, body)
    if (parsedTag) {
      segments.push(parsedTag)
    }

    cursor = closeIdx + closeTag.length
  }

  if (segments.length === 0 && !hasPendingTag) {
    segments.push({ type: 'text', content })
  }

  return { segments, hasPendingTag }
}
