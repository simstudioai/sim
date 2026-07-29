'use client'

import { createElement, lazy, Suspense, useMemo, useState } from 'react'
import {
  ArrowRight,
  Button,
  ChevronDown,
  cn,
  Expandable,
  ExpandableContent,
  SecretInput,
  SecretReveal,
  Tooltip,
  toast,
} from '@sim/emcn'
import { useParams } from 'next/navigation'
import { ThinkingLoader } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import { QuestionDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import type {
  ChatMessageContext,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
// Deep import, not the barrel: the barrel also re-exports
// ConnectServiceAccountModal, and that edge would pull the modal into this
// chunk and defeat the lazy() split below.
import { useServiceAccountConnectTarget } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/use-service-account-connect'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

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

/**
 * Kept out of the chat's initial chunk — it pulls in three provider-specific
 * setup forms and is only mounted once a message actually offers a service
 * account.
 */
const ConnectServiceAccountModal = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'
  ).then((m) => ({ default: m.ConnectServiceAccountModal }))
)

export const CREDENTIAL_TAG_TYPES = [
  'env_key',
  'oauth_key',
  'sim_key',
  'credential_id',
  'link',
  'secret_input',
  'service_account',
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
  /**
   * Existing credential to reconnect in place (service_account only). Present =
   * rotate the secret on this credential; absent = create a new one.
   */
  credentialId?: string
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

/**
 * Every tag the parser resolves. Exported so tests can assert their fixtures
 * cover all of them rather than hand-picking a subset that silently drifts —
 * the same treatment the sibling `*_TYPES` unions above already get.
 */
export const SPECIAL_TAG_NAMES = [
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
  // A service_account tag is a control, not a value: it names the provider
  // whose setup form to open, and the user types the secret into that form —
  // so it never carries a `value`, but it is useless without a provider. An
  // optional `credentialId` reconnects an existing service account in place;
  // reject a blank one, since the renderer treats a truthy id as "reconnect"
  // and would try to rotate a non-existent credential.
  if (value.type === 'service_account') {
    if (value.credentialId !== undefined) {
      if (typeof value.credentialId !== 'string' || value.credentialId.trim().length === 0) {
        return false
      }
    }
    return typeof value.provider === 'string' && value.provider.trim().length > 0
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

/**
 * Whether `body` is syntactically valid JSON, regardless of its shape.
 *
 * Separates "the agent formed a payload that failed its shape guard" from "this
 * was never JSON" — the line that decides whether a failed body may be dropped
 * or must be shown (see {@link classifyBody}). Costs a second parse of a body
 * that already failed one, which is the rare path; the common cases never reach
 * it, since a valid payload returns earlier and prose is rejected by the cheaper
 * viability rule before this runs.
 */
function isParseableJson(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
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
 * Any tag-shaped marker, including names that are not special tags at all — the
 * model inventing `</workflow_resource>` is exactly the case that matters.
 */
const TAG_SHAPED_MARKER = /<\/?[a-zA-Z][\w-]*>/

/**
 * The one tag whose body is prose rather than JSON (see {@link parseTextTagBody}),
 * so a non-JSON body there says nothing about whether a close is still coming.
 */
const PROSE_BODY_TAG_NAME: (typeof SPECIAL_TAG_NAMES)[number] = 'thinking'

/**
 * Tags whose body must be JSON.
 *
 * Derived from {@link SPECIAL_TAG_NAMES} rather than hand-listed: a new tag is
 * JSON-bodied by default, so forgetting to update this set cannot silently
 * downgrade it to the weaker prose heuristics. Opting a tag out is an explicit
 * edit to {@link PROSE_BODY_TAG_NAME}.
 */
const JSON_BODY_TAG_NAMES: ReadonlySet<(typeof SPECIAL_TAG_NAMES)[number]> = new Set(
  SPECIAL_TAG_NAMES.filter((name) => name !== PROSE_BODY_TAG_NAME)
)

/**
 * How much of a body to inspect per parse, on both the unclosed and matched-pair
 * paths.
 *
 * The rules in {@link unclosedTagCannotResolve} and {@link literalTextReason}
 * decide on their FIRST piece of evidence — the first foreign marker, or the
 * first character that breaks JSON viability — so a bounded window reaches the
 * same verdict as the full remainder for any payload a tag actually carries.
 * Unbounded, the check is O(body length) and runs once per opener inside a parse
 * that re-runs for every streamed chunk. A long reply repeatedly mentioning a
 * tag name, or one whose misspelled early close stretches a single body across
 * most of the message, is then quadratic in the length of the reply.
 *
 * The window's one blind spot, and why it is accepted: a JSON body whose
 * top-level value closes BEYOND the window, followed by prose and no closing tag,
 * still reads as a viable prefix, so the remainder stays hidden until the stream
 * ends rather than settling mid-stream. It is lossless — the completed parse
 * renders every character — and it needs a payload several times larger than any
 * tag emits (a `<workspace_resource>` runs ~100 characters, a `<question>` card
 * under ~1500). A mention in prose settles at its first character at any length,
 * because prose does not open with `{`. Widening or removing the window to close
 * that gap would trade a measured, reachable main-thread freeze for a
 * hypothetical one.
 */
const MAX_UNCLOSED_BODY_SCAN = 4096

/**
 * Length of the longest marker the scans can match.
 *
 * Derived from {@link SPECIAL_TAG_NAMES} rather than hand-counted, so adding a
 * longer tag name cannot silently shrink the rewind in {@link resumeForClass}.
 * Closing markers are the longer of the two forms, so they set the bound.
 */
const LONGEST_TAG_MARKER = Math.max(...SPECIAL_TAG_NAMES.map((name) => `</${name}>`.length))

/**
 * Strip the contents of JSON string literals from `body`, replacing them with
 * spaces so every other index is preserved.
 *
 * A JSON tag body can legitimately quote tag syntax — a `<question>` asking
 * which tag to use, or a `<workspace_resource>` whose title mentions one. Those
 * markers live inside a string and say nothing about whether the tag will
 * close, so the nesting rule must not see them. Tracks escapes so a `\"` inside
 * a string does not end it early. Handles an unterminated trailing string, which
 * is the normal state mid-stream.
 *
 * Index preservation is load-bearing, not decorative: {@link resumeForClass} takes an
 * offset found in the blanked copy and applies it to the RAW body. Iteration is by
 * code point, so a blanked astral character must emit `char.length` spaces —
 * emitting one would shrink the output and shift every later offset left.
 */
function blankJsonStringLiterals(body: string): string {
  // With no quote there is no string literal, so the loop below would copy the
  // body to itself character by character. Both callers reach here on bodies
  // that are usually plain prose, and this runs per opener per streamed chunk.
  if (!body.includes('"')) return body

  let out = ''
  let inString = false
  let escaped = false

  for (const char of body) {
    if (escaped) {
      escaped = false
      out += ' '.repeat(char.length)
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      out += ' '
      continue
    }
    if (char === '"') {
      inString = !inString
      out += '"'
      continue
    }
    out += inString ? ' '.repeat(char.length) : char
  }

  return out
}

/**
 * True while `scannable` could still grow into a single valid JSON value.
 *
 * Checking only the first character is not enough: a body like
 * `{"type":"file"}</workspac and then prose...` opens with `{` and looks fine,
 * but the value CLOSES at the `}` and everything after it is fatal. Tracking
 * depth catches that the moment the stray character arrives, instead of waiting
 * for a close tag that is never coming.
 *
 * Takes a body whose string literals are ALREADY blanked by
 * {@link blankJsonStringLiterals}, so braces and brackets inside JSON strings do
 * not affect the depth count. Both callers blank the body for their own marker
 * scan first, so taking the blanked form avoids a second pass over the same text.
 */
function isViableJsonPrefixOf(scannable: string): boolean {
  if (scannable.trim() === '') return true

  const firstChar = scannable.trimStart().charAt(0)
  if (firstChar !== '{' && firstChar !== '[') return false

  let depth = 0
  for (let i = 0; i < scannable.length; i++) {
    const char = scannable[i]
    if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth < 0) return false
      // The top-level value just closed: only trailing whitespace may follow.
      if (depth === 0) return scannable.slice(i + 1).trim() === ''
    }
  }

  return true
}

/**
 * Whether `text` contains a marker for one of the tags this parser knows.
 *
 * Deliberately the tag NAMES rather than anything tag-shaped. A prose body may
 * legitimately contain `<div>` or `Promise<void>`; only a marker the parser
 * would itself act on proves the enclosing opener was text. Shared so the
 * streaming and matched-pair paths cannot answer the same question differently
 * — them disagreeing is what let a late close swallow content already on screen.
 *
 * The match is by substring, so a generic is safe only when its parameter is not
 * itself a tag name: `Promise<void>` does not match, `Promise<options>` does. The
 * narrowing is not worth its cost — it needs a `<thinking>` body, which the agent
 * no longer emits (reasoning arrives as structured thinking blocks), discussing a
 * type named exactly after a tag; and the boundary check that would fix it wants a
 * lookbehind, unavailable on the Safari versions this app still supports.
 */
function hasSpecialTagMarker(text: string): boolean {
  return SPECIAL_TAG_NAMES.some((name) => text.includes(`</${name}>`) || text.includes(`<${name}>`))
}

/**
 * True when an opening tag with no close yet can NEVER resolve, so the text
 * after it should be shown immediately instead of held back until the stream
 * ends. Without it, a message that merely mentions a tag in prose goes blank
 * from that point on until streaming stops.
 *
 * One rule decides it, chosen by body kind:
 *
 * - **JSON-bodied tags** must stay a viable JSON prefix. Depth is tracked rather
 *   than testing the first character alone, so a body whose top-level value has
 *   already closed is caught the moment stray content follows it — a mention in
 *   prose (no `{` at all), a misspelled close like `</workflow_resource>`, a
 *   truncated `</workspac`, or no close whatsoever.
 * - **The prose-bodied tag** has no JSON to test, so the only evidence available
 *   is that tags never nest: a marker for another special tag in the body means
 *   this opener was literal text.
 *
 * Nested markers are NOT scanned for on a JSON body. A marker outside a string
 * literal is content the viability rule already rejects, and one inside is
 * legitimate quoted syntax that must not count as evidence — so the scan cost a
 * pass per tag name, open and close, to catch nothing.
 *
 * Both rules are conservative: they fire only on content that could not have
 * parsed. A false positive merely shows text early that a later chunk resolves
 * into a tag, and the end-of-stream parse still renders correctly.
 */
function unclosedTagCannotResolve(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
): boolean {
  const pending = dropArrivingClose(body, `</${tagName}>`)

  if (!JSON_BODY_TAG_NAMES.has(tagName)) return hasSpecialTagMarker(pending)

  // Cheap rejection before the expensive one. isViableJsonPrefixOf decides on
  // the first non-whitespace character when it is not `{` or `[` — which is the
  // common case, a tag name mentioned in prose — so testing it here avoids
  // blanking up to a full window of text only to throw the copy away.
  const firstChar = pending.trimStart().charAt(0)
  if (firstChar !== '' && firstChar !== '{' && firstChar !== '[') return true

  // Blank string literals first so braces and brackets inside JSON strings do
  // not throw off the depth count.
  return !isViableJsonPrefixOf(blankJsonStringLiterals(pending))
}

/**
 * Drop a trailing fragment that could still grow into `closeTag`.
 *
 * Mid-stream the closing marker arrives a character at a time, so a body sits at
 * `]</opt` for several frames before `</options>` completes. That fragment is an
 * arriving close, not stray content — counting it as fatal is what made a
 * perfectly valid tag show its raw payload as text until the final `>` landed.
 *
 * Only a fragment at the very END is dropped, so evidence that the close is
 * genuinely wrong still lands immediately: a misspelled `</workflow_resource>`
 * is not a prefix of `</workspace_resource>`, and a truncated `</workspac`
 * followed by prose stops being one the moment the prose arrives.
 */
function dropArrivingClose(body: string, closeTag: string): string {
  for (let n = Math.min(closeTag.length - 1, body.length); n > 0; n--) {
    if (body.endsWith(closeTag.slice(0, n))) return body.slice(0, -n)
  }
  return body
}

/**
 * How one opening tag resolved. Naming the four outcomes is the point: the
 * parser previously decided each case inline, which is how "drop it" quietly
 * became the fallback for situations that were never malformed payloads.
 */
type TagResolution =
  /** Body parsed; emit the typed segment and resume after the closing tag. */
  | { outcome: 'segment'; segment: ContentSegment; resumeAt: number }
  /** Provably not a tag; render the span verbatim and resume after it. */
  | { outcome: 'literal'; resumeAt: number }
  /** A well-formed payload that failed its shape guard — dropped deliberately. */
  | { outcome: 'discard'; resumeAt: number }
  /** Still streaming and a close remains plausible; suppress the remainder. */
  | { outcome: 'pending' }

/**
 * Why a failed body was never an attempted payload — so the markers were literal
 * text and the span must be shown rather than swallowed. `null` means the body
 * really was a payload that failed its shape guard.
 *
 * The two reasons resume differently, which is why they are distinguished
 * rather than collapsed into a boolean (see {@link resumeForClass}).
 */
type LiteralTextVerdict =
  /**
   * The body carries a tag marker at `markerOffset` (an index into the body), so
   * the close we matched belongs to a different opener.
   */
  | { reason: 'foreign-markers'; markerOffset: number }
  /** The tag wrapped prose that was never JSON to begin with. */
  | { reason: 'never-a-payload' }

function literalTextReason(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
): LiteralTextVerdict | null {
  const isJsonBodied = JSON_BODY_TAG_NAMES.has(tagName)
  // Markers inside a JSON string are content, not evidence — a `<question>` may
  // legitimately quote tag syntax in its prompt. Scanning the raw body here
  // would classify a broken payload as literal text and render it as raw JSON,
  // which is exactly what `discard` exists to prevent. Mirrors the same blanking
  // in unclosedTagCannotResolve, which judges the same body mid-stream.
  const scannable = isJsonBodied ? blankJsonStringLiterals(body) : body
  const marker = TAG_SHAPED_MARKER.exec(scannable)
  if (marker) return { reason: 'foreign-markers', markerOffset: marker.index }
  if (isJsonBodied && !isViableJsonPrefixOf(scannable)) return { reason: 'never-a-payload' }
  return null
}

/** One memoized `indexOf` result, with the `from` it was computed at. */
interface IndexOfCacheEntry {
  /** Result of `content.indexOf(needle, from)`, or -1 when absent from that point on. */
  idx: number
  /** The offset the search started at. The entry says nothing about content before it. */
  from: number
}

export type IndexOfCache = Map<string, IndexOfCacheEntry>

/**
 * `content.indexOf(needle, from)` memoized per needle.
 *
 * The opener scan and the close lookup search the same handful of markers over
 * and over as the cursor advances. A needle absent from the message resolves to
 * -1 once and is never searched again; a present one is re-searched only when
 * the cursor passes its last hit. Unmemoized, each lookup rescans to the end of
 * the buffer for every opener, which is quadratic on a message that mentions a
 * tag name many times — and this parse re-runs for every streamed chunk.
 *
 * A cached result is only valid from the offset it was searched at, so the entry
 * carries that offset and is reused only when the new `from` is at or beyond it:
 *
 * - `idx === -1` means no hit at or after `entry.from`, so there is none at or
 *   after any later `from` either.
 * - `idx >= from` means the first hit at or after `entry.from` is still ahead of
 *   `from`, so nothing lies between them and it is still the first hit.
 *
 * Storing `from` is what makes this correct for ANY call order rather than only
 * for a monotonically advancing cursor. The cursor is monotonic today — every
 * non-pending outcome resumes strictly past its opener — but that is a property
 * of {@link resolveTagAt}'s resume points, and one of them deliberately resumes
 * back inside a span it already examined. A future adjustment that let the cursor
 * regress would, without this check, return a stale index and silently mis-parse
 * rather than fail loudly. With it, the worst case is a redundant scan.
 */
export function memoizedIndexOf(
  cache: IndexOfCache,
  content: string,
  needle: string,
  from: number
): number {
  const entry = cache.get(needle)
  if (entry && from >= entry.from && (entry.idx === -1 || entry.idx >= from)) return entry.idx
  const idx = content.indexOf(needle, from)
  cache.set(needle, { idx, from })
  return idx
}

/**
 * How much of a body may be inspected, and whether that is all of it.
 *
 * The read budget, isolated from what the body turns out to BE. Both the
 * unclosed and matched-pair paths spend it through this one function, so they
 * cannot drift out of agreement about how much of a body may be read.
 */
interface InspectedBody {
  /** The prefix actually examined. */
  text: string
  /** True when `text` is only a prefix, so no verdict drawn from it covers the rest. */
  truncated: boolean
}

function inspectWithin(source: string, start = 0): InspectedBody {
  const end = start + MAX_UNCLOSED_BODY_SCAN
  return end < source.length
    ? { text: source.slice(start, end), truncated: true }
    : { text: start === 0 ? source : source.slice(start), truncated: false }
}

/**
 * What a matched body turned out to BE — independent of what the parser does
 * about it, and of where it resumes.
 *
 * A closed set, and that is the whole point: {@link resolveMatchedPair} and
 * {@link resumeForClass} each switch over it exhaustively, so adding a case
 * fails to compile until BOTH questions are answered for it. Every regression
 * review found on this parser was one of those two answers changing without the
 * other, which is a mistake this shape makes unrepresentable.
 */
type BodyClass =
  /** Parsed, and matched its shape guard. */
  | { kind: 'payload'; segment: ContentSegment }
  /** A tag marker at `offsetInBody` proves the close we matched belongs elsewhere. */
  | { kind: 'nested-marker'; offsetInBody: number }
  /**
   * The same proof, in a PROSE body. Separate because it resumes differently: a
   * prose body is never blanked, so nothing is hidden from the scan and rescanning
   * from the opener is safe, and these bodies are small enough that the extra pass
   * is free. Resuming at the marker instead would also be correct and would emit
   * one text segment rather than two — display-identical, since the renderer
   * concatenates them — but it is a behaviour change and does not belong in a
   * refactor.
   */
  | { kind: 'prose-nested-marker' }
  /** Only a prefix was read, and it settled nothing. Says nothing about the rest. */
  | { kind: 'unexamined' }
  /** Not a payload at all — never JSON, or JSON that will not parse. */
  | { kind: 'never-json' }
  /** Parsed as JSON, then failed its shape guard. The only droppable class. */
  | { kind: 'broken-payload' }

/**
 * Classify a complete body. Pure: no positions, no outcome, no resume.
 *
 * Order is behavioural, not stylistic. The prose-nesting rule precedes the parse
 * because a prose body has no shape to fail — any non-empty text qualifies — so a
 * late close would otherwise swallow whatever the streaming path already showed.
 * The budget precedes the remaining rules so an unread remainder is never
 * mistaken for evidence.
 */
function classifyBody(tagName: (typeof SPECIAL_TAG_NAMES)[number], body: string): BodyClass {
  const isJsonBodied = JSON_BODY_TAG_NAMES.has(tagName)

  if (!isJsonBodied) {
    // The same predicate the streaming path uses, so the two cannot disagree
    // about whether this body was ever a tag. Tag NAMES, not anything
    // tag-shaped: reasoning that mentions `<div>` or `Promise<void>` is still
    // reasoning, and releasing it as prose would put the model's thinking on
    // screen for an incidental angle bracket.
    if (hasSpecialTagMarker(body)) return { kind: 'prose-nested-marker' }
  }

  const parsed = parseSpecialTagData(tagName, body)
  if (parsed) return { kind: 'payload', segment: parsed }

  const inspected = inspectWithin(body)
  const verdict = literalTextReason(tagName, inspected.text)

  if (verdict?.reason === 'foreign-markers') {
    return { kind: 'nested-marker', offsetInBody: verdict.markerOffset }
  }
  if (inspected.truncated) return { kind: 'unexamined' }

  // Dropping text is only defensible for a payload the agent actually FORMED.
  // `{the Q4 report}` is prose in braces and `{type: "file"}` is an ordinary
  // model slip; bracket depth cannot tell either from a real payload, only a
  // parse can. Both routes to that answer are funnelled through one place so the
  // rescan below cannot be added to one and forgotten on the other.
  const neverJson =
    verdict?.reason === 'never-a-payload' || (isJsonBodied && !isParseableJson(body))

  if (neverJson) {
    // literalTextReason blanked this body's quoted regions on the assumption it
    // was JSON. It never was, so that assumption is void — and a body with an
    // odd number of `"` blanks the WRONG regions, which can hide a real marker
    // and turn what should be `nested-marker` into `never-json`. The difference
    // is not academic: `never-json` resumes past the close, flattening a genuine
    // tag inside the span, so a card already on screen un-renders when the close
    // finally arrives. With the JSON premise gone, the raw text is the honest
    // evidence, and a marker in it means the close we matched belongs elsewhere.
    const rawMarker = TAG_SHAPED_MARKER.exec(inspected.text)
    if (rawMarker) return { kind: 'nested-marker', offsetInBody: rawMarker.index }
    return { kind: 'never-json' }
  }

  return { kind: 'broken-payload' }
}

/**
 * Where scanning continues, given what the body was. The third concern, kept
 * apart from the other two so a change to one cannot silently alter another.
 *
 * Every branch is strictly greater than the opener, which is what guarantees the
 * cursor advances and {@link memoizedIndexOf}'s cache stays coherent.
 */
function resumeForClass(cls: BodyClass, bodyStart: number, pastClose: number): number {
  switch (cls.kind) {
    case 'payload':
    case 'broken-payload':
    case 'never-json':
      // The whole span was read and accounted for; continue after it.
      return pastClose
    case 'nested-marker':
      // Resume AT the marker, not past the borrowed close and not at the opener.
      // Past the close would skip a genuine tag after it; the opener would rescan
      // a region the blanked scan could not see into, re-parsing tag syntax
      // quoted inside a JSON string and dropping it.
      return bodyStart + cls.offsetInBody
    case 'prose-nested-marker':
      // Rescan the whole body: nothing was blanked, so no marker is hidden.
      return bodyStart
    case 'unexamined':
      // Resume just short of the first character NOT read: the last marker's
      // worth of the window is held back rather than emitted as text, so it is
      // re-scanned on the next pass instead of being flattened. Nothing is lost
      // — the caller emits up to wherever this resumes. It still advances nearly
      // a full window per step, so a long body costs a bounded number of
      // re-entries.
      //
      // The rewind is load-bearing: the window edge is an arbitrary cut, so an
      // opener can straddle it. Resuming exactly at the edge leaves that opener's
      // `<` behind the cursor, and the opener scan only looks FORWARD — so the tag
      // is never found and renders as raw payload text, on a completed message.
      // Backing off by the longest marker guarantees any straddling opener is
      // re-scanned from its `<`.
      return bodyStart + MAX_UNCLOSED_BODY_SCAN - (LONGEST_TAG_MARKER - 1)
  }
}

function resolveMatchedPair(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string,
  bodyStart: number,
  pastClose: number
): TagResolution {
  const cls = classifyBody(tagName, body)
  const resumeAt = resumeForClass(cls, bodyStart, pastClose)

  switch (cls.kind) {
    case 'payload':
      return { outcome: 'segment', segment: cls.segment, resumeAt }
    case 'broken-payload':
      // Well-formed but the wrong shape — a broken emission. Showing the reader
      // raw JSON is worse than showing nothing.
      return { outcome: 'discard', resumeAt }
    case 'nested-marker':
    case 'prose-nested-marker':
    case 'unexamined':
    case 'never-json':
      return { outcome: 'literal', resumeAt }
  }
}

function resolveTagAt(
  content: string,
  openIndex: number,
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  isStreaming: boolean,
  closeCache: IndexOfCache
): TagResolution {
  const openTag = `<${tagName}>`
  const closeTag = `</${tagName}>`
  const bodyStart = openIndex + openTag.length
  const closeIdx = memoizedIndexOf(closeCache, content, closeTag, bodyStart)

  if (closeIdx === -1) {
    const inspected = inspectWithin(content, bodyStart)
    if (isStreaming && !unclosedTagCannotResolve(tagName, inspected.text)) {
      return { outcome: 'pending' }
    }
    // Nothing can close it, so only the opener itself is literal. Resuming just
    // past it (rather than abandoning the message) keeps a genuinely valid tag
    // later in the same reply parseable.
    return { outcome: 'literal', resumeAt: bodyStart }
  }

  return resolveMatchedPair(
    tagName,
    content.slice(bodyStart, closeIdx),
    bodyStart,
    closeIdx + closeTag.length
  )
}

/**
 * Splits streamed text into renderable segments, extracting complete special
 * tags and deciding what to do with the ones that never resolve. Incomplete
 * tags are suppressed and flagged via `hasPendingTag` so the caller can show a
 * loading indicator, and a trailing partial opening marker (`<opt`, `<usage_`)
 * is stripped during streaming so it never flashes as raw markup.
 */
export function parseSpecialTags(content: string, isStreaming: boolean): ParsedSpecialContent {
  const segments: ContentSegment[] = []
  let hasPendingTag = false
  let cursor = 0

  // Whitespace-only spans are kept, not trimmed away: the literal path emits a
  // rejected span in several pieces, and a `\n\n` between two of them is a
  // markdown paragraph break. Dropping it silently merges two paragraphs, because
  // the renderer concatenates adjacent text segments into one markdown string.
  const pushText = (text: string) => {
    if (text) segments.push({ type: 'text', content: text })
  }

  const openerCache: IndexOfCache = new Map()
  const closeCache: IndexOfCache = new Map()
  let discardedTag = false

  while (cursor < content.length) {
    let nearestStart = -1
    let nearestTagName: (typeof SPECIAL_TAG_NAMES)[number] | '' = ''

    for (const name of SPECIAL_TAG_NAMES) {
      const idx = memoizedIndexOf(openerCache, content, `<${name}>`, cursor)
      if (idx !== -1 && (nearestStart === -1 || idx < nearestStart)) {
        nearestStart = idx
        nearestTagName = name
      }
    }

    // Only the name is tested: the two are assigned together above, so an empty
    // name and a -1 start are the same state — and the name is the one that
    // needs narrowing before resolveTagAt below.
    if (nearestTagName === '') {
      let remaining = content.slice(cursor)

      if (isStreaming) {
        // Hide a half-arrived opening marker so it does not flash as text.
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

      pushText(remaining)
      break
    }

    pushText(content.slice(cursor, nearestStart))

    const resolution = resolveTagAt(content, nearestStart, nearestTagName, isStreaming, closeCache)

    if (resolution.outcome === 'pending') {
      hasPendingTag = true
      break
    }

    if (resolution.outcome === 'segment') {
      segments.push(resolution.segment)
    } else if (resolution.outcome === 'literal') {
      pushText(content.slice(nearestStart, resolution.resumeAt))
    } else {
      // `discard` deliberately emits nothing. Remembering that it happened is
      // what keeps the fallback below from undoing it.
      discardedTag = true
    }

    cursor = resolution.resumeAt
  }

  // A message with no segments is normally a message with nothing in it, and
  // emitting the raw content is the right floor. But a discard produces no
  // segment BY DESIGN, so without this guard a message that is only a broken
  // payload falls through and renders the exact raw JSON the discard removed.
  if (segments.length === 0 && !hasPendingTag && !discardedTag) {
    segments.push({ type: 'text', content })
  }

  return { segments, hasPendingTag }
}

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`.
 */
export function SpecialTags({
  segment,
  questionAnswers,
  onOptionSelect,
  onQuestionDismiss,
  onWorkspaceResourceSelect,
}: SpecialTagsProps) {
  switch (segment.type) {
    case 'thinking':
      return null
    case 'options':
      return <OptionsDisplay data={segment.data} onSelect={onOptionSelect} />
    case 'usage_upgrade':
      return <UsageUpgradeDisplay data={segment.data} />
    case 'credential':
      return <CredentialDisplay data={segment.data} />
    case 'mothership-error':
      return <MothershipErrorDisplay data={segment.data} />
    case 'workspace_resource':
      return <WorkspaceResourceDisplay data={segment.data} onSelect={onWorkspaceResourceSelect} />
    case 'question':
      return (
        <QuestionDisplay
          data={segment.data}
          answers={questionAnswers}
          onSelect={onOptionSelect}
          onDismiss={onQuestionDismiss}
        />
      )
    default:
      return null
  }
}

interface PendingTagIndicatorProps {
  /** Activity phrase next to the loader; crossfades on change. */
  label: string
}

/**
 * Renders the turn-level activity shimmer.
 */
export function PendingTagIndicator({ label }: PendingTagIndicatorProps) {
  return (
    <div className='animate-stream-fade-in py-2'>
      <ThinkingLoader size={20} startVariant='corners' label={label} labelRatio={0.7} />
    </div>
  )
}

interface OptionsDisplayProps {
  data: OptionsTagData
  onSelect?: (id: string) => void
}

function OptionsDisplay({ data, onSelect }: OptionsDisplayProps) {
  const disabled = !onSelect
  const [collapsedByUser, setCollapsedByUser] = useState(false)
  // When interactive (not disabled), always expanded. When disabled, the user can toggle.
  const expanded = !disabled || !collapsedByUser
  const entries = Object.entries(data)

  if (entries.length === 0) return null

  return (
    <div>
      {disabled ? (
        <button
          type='button'
          onClick={() => setCollapsedByUser((prev) => !prev)}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
      )}
      <Expandable expanded={expanded}>
        <ExpandableContent className='mt-1.5'>
          <div className='flex flex-col'>
            {entries.map(([key, value], i) => {
              const title = value.title

              return (
                <button
                  key={key}
                  type='button'
                  disabled={disabled}
                  onClick={() => onSelect?.(title)}
                  className={cn(
                    'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors',
                    disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
                    <span className='text-[var(--text-icon)] text-sm'>{i + 1}</span>
                  </div>
                  <span className='flex-1 text-[var(--text-body)] text-sm'>{title}</span>
                  <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}

function fallbackWorkspaceResourceTitle(type: WorkspaceResourceTagType): string {
  switch (type) {
    case 'workflow':
      return 'Workflow'
    case 'table':
      return 'Table'
    case 'file':
      return 'File'
  }
}

function toMothershipResourceType(type: WorkspaceResourceTagType): MothershipResource['type'] {
  return type
}

function toChatMessageContext(data: WorkspaceResourceTagData, label: string): ChatMessageContext {
  switch (data.type) {
    case 'workflow':
      return { kind: 'workflow', label, workflowId: data.id ?? '' }
    case 'table':
      return { kind: 'table', label, tableId: data.id ?? '' }
    case 'file':
      return { kind: 'file', label, fileId: data.id ?? data.path ?? '' }
  }
}

export function WorkspaceResourceDisplay({
  data,
  onSelect,
}: {
  data: WorkspaceResourceTagData
  onSelect?: (resource: MothershipResource) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const resource = useMemo<MothershipResource>(() => {
    const fileFromPath =
      data.type === 'file' && data.path
        ? files.find(
            (file) =>
              canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name }) ===
              data.path
          )
        : undefined
    const title =
      data.type === 'workflow'
        ? (workflows.find((workflow) => workflow.id === data.id)?.name ??
          fallbackWorkspaceResourceTitle(data.type))
        : data.type === 'table'
          ? (tables.find((table) => table.id === data.id)?.name ??
            fallbackWorkspaceResourceTitle(data.type))
          : data.type === 'file'
            ? (files.find((file) => file.id === data.id)?.name ??
              fileFromPath?.name ??
              data.title ??
              fallbackWorkspaceResourceTitle(data.type))
            : (knowledgeBases.find((knowledgeBase) => knowledgeBase.id === data.id)?.name ??
              fallbackWorkspaceResourceTitle(data.type))

    return {
      type: toMothershipResourceType(data.type),
      id: data.id ?? fileFromPath?.id ?? data.path ?? '',
      title,
      ...(data.type === 'file' && data.path ? { path: data.path } : {}),
    }
  }, [data.id, data.path, data.title, data.type, files, knowledgeBases, tables, workflows])

  const context = toChatMessageContext(data, resource.title)

  const mentionContent = (
    <>
      <ContextMentionIcon
        context={context}
        className='relative top-0.5 size-[12px] flex-shrink-0 text-[var(--text-icon)]'
      />
      {resource.title}
    </>
  )

  const classes =
    'inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] align-baseline font-[inherit] text-[inherit] leading-[inherit]'

  if (!onSelect) {
    return <span className={classes}>{mentionContent}</span>
  }

  return (
    <button
      type='button'
      onClick={() => onSelect(resource)}
      className={cn(classes, 'cursor-pointer transition-colors hover-hover:bg-[var(--surface-6)]')}
    >
      {mentionContent}
    </button>
  )
}

function getCredentialIcon(provider: string): React.ComponentType<{ className?: string }> | null {
  const lower = provider.toLowerCase()

  const directMatch = OAUTH_PROVIDERS[lower]
  if (directMatch) return directMatch.icon

  for (const config of Object.values(OAUTH_PROVIDERS)) {
    if (config.name.toLowerCase() === lower) return config.icon
    for (const service of Object.values(config.services)) {
      if (service.name.toLowerCase() === lower) return service.icon
      if (service.providerId.toLowerCase() === lower) return service.icon
    }
  }

  return null
}

const LockIcon = (props: { className?: string }) => (
  <svg
    className={props.className}
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect x='2' y='5' width='12' height='8' rx='1.5' stroke='currentColor' strokeWidth='1.3' />
    <path
      d='M5 5V3.5a3 3 0 1 1 6 0V5'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
    />
    <circle cx='8' cy='9.5' r='1.25' fill='currentColor' />
  </svg>
)

/**
 * Inline "paste a secret" widget rendered for
 * `<credential>{"type":"secret_input","name":"OPENAI_API_KEY"}</credential>`.
 * Reuses the shared emcn SecretInput; the pasted value is saved straight to
 * workspace (default) or personal environment variables under `name` and never
 * flows back through the chat transcript.
 */
function SecretInputDisplay({ data }: { data: CredentialTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const secretName = (data.name ?? '').trim()
  const scope: SecretInputScope = data.scope === 'personal' ? 'personal' : 'workspace'

  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment()
  const personalEnv = personalQuery.data
  const { canEdit } = useUserPermissionsContext()

  // Setting a workspace var needs write/admin (same gate as the secrets manager);
  // personal vars are the user's own, so any member may set them.
  const canManage = scope === 'personal' || canEdit

  const isSaving = upsertWorkspace.isPending || savePersonal.isPending
  // Personal saves replace the whole map, so block until existing vars are loaded.
  const personalReady = scope !== 'personal' || personalEnv !== undefined
  const canSave =
    canManage && secretName.length > 0 && value.trim().length > 0 && !isSaving && personalReady

  const handleSave = async () => {
    if (!canSave) return
    try {
      if (scope === 'personal') {
        // The personal POST replaces the whole map, so re-read the latest vars
        // right before merging — a stale snapshot would drop keys saved elsewhere.
        const { data: latest } = await personalQuery.refetch()
        const merged: Record<string, string> = {}
        for (const [key, entry] of Object.entries(latest ?? personalEnv ?? {}))
          merged[key] = entry.value
        merged[secretName] = value
        await savePersonal.mutateAsync({ variables: merged })
      } else {
        await upsertWorkspace.mutateAsync({ workspaceId, variables: { [secretName]: value } })
      }
      setValue('')
      setSaved(true)
      toast.success(`Saved ${secretName}`)
    } catch {
      toast.error(`Couldn't save ${secretName}. Please try again.`)
    }
  }

  if (!secretName) return null
  // Only confirm after the user saves via THIS widget. A fresh prompt always shows
  // the input so the user can set or override the key, even if it already exists.
  if (saved) return <SecretReveal redacted />
  if (!canManage) return null

  return (
    <SecretInput
      value={value}
      onChange={setValue}
      placeholder={`Paste ${secretName}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void handleSave()
        }
      }}
      endAdornment={
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='quiet'
              className='size-[18px] rounded-sm p-0'
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-label='Save'
            >
              <ArrowRight className='size-[13px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isSaving ? 'Saving…' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

/**
 * Inline "set up a service account" control rendered for
 * `<credential>{"type":"service_account","provider":"slack"}</credential>`.
 *
 * Opens `ConnectServiceAccountModal` over the chat rather than linking out to
 * the integrations page — the user stays in the conversation that asked for
 * the credential, and comes back to it with the credential in hand.
 */
function ServiceAccountConnectDisplay({ data }: { data: CredentialTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [open, setOpen] = useState(false)

  const match = useMemo(
    () => (data.provider ? resolveServiceAccountIntegration(data.provider) : null),
    [data.provider]
  )
  const service = useMemo(() => (match ? resolveOAuthServiceForSlug(match.slug) : null), [match])
  const target = useServiceAccountConnectTarget({
    serviceAccountProviderId: match?.serviceAccountProviderId,
    serviceName: match?.serviceName,
    serviceIcon: service?.serviceIcon,
  })

  // A credentialId reconnects (rotates the secret on) that existing service
  // account in place rather than creating a new one — the modal keeps its id.
  const reconnectCredentialId = data.credentialId
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)

  // Creating a credential mutates the workspace — hide it from read-only
  // members, and honour the provider's own preview gate (custom Slack bots
  // ride the slack_v2 flag) so chat can't surface what the integrations page
  // deliberately hides.
  if (!target || target.hidden || !canEdit || !workspaceId) return null

  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? target.serviceName}`
    : `${target.label} for ${target.serviceName}`

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors hover-hover:bg-[var(--surface-5)]'
      >
        {createElement(target.serviceIcon, { className: 'size-[16px] shrink-0' })}
        <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      </button>
      {open && (
        <Suspense fallback={null}>
          <ConnectServiceAccountModal
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            serviceAccountProviderId={target.serviceAccountProviderId}
            serviceName={target.serviceName}
            serviceIcon={target.serviceIcon}
            credentialId={reconnectCredentialId}
            credentialDisplayName={reconnectCredential?.displayName ?? undefined}
          />
        </Suspense>
      )}
    </>
  )
}

function CredentialLinkDisplay({ data }: { data: CredentialTagData }) {
  const { canEdit } = useUserPermissionsContext()

  // A connect URL carrying a credentialId re-authorizes that existing
  // credential in place (reconnect) rather than creating a new one.
  const reconnectCredentialId = useMemo(() => {
    if (!data.value) return undefined
    try {
      return new URL(data.value).searchParams.get('credentialId') ?? undefined
    } catch {
      return undefined
    }
  }, [data.value])
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)

  // Connecting a credential mutates the workspace — hide it from read-only members.
  if (!data.provider || !canEdit) return null
  // The connect link value comes from the streamed model output, so only
  // render it as a clickable link when it resolves to a real http(s) URL.
  if (!data.value || !isSafeHttpUrl(data.value)) return null
  const Icon = getCredentialIcon(data.provider) ?? LockIcon
  const integrationName =
    getServiceConfigByProviderId(data.provider)?.name ??
    OAUTH_PROVIDERS[data.provider.toLowerCase()]?.name ??
    data.provider
  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : `Connect ${integrationName}`
  return (
    <a
      href={data.value}
      target='_blank'
      rel='noopener noreferrer'
      className='flex items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 transition-colors hover-hover:bg-[var(--surface-5)]'
    >
      {createElement(Icon, { className: 'size-[16px] shrink-0' })}
      <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
      <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
    </a>
  )
}

function CredentialDisplay({ data }: { data: CredentialTagData }) {
  if (data.type === 'secret_input') {
    return <SecretInputDisplay data={data} />
  }

  if (data.type === 'link') {
    return <CredentialLinkDisplay data={data} />
  }

  if (data.type === 'service_account') {
    return <ServiceAccountConnectDisplay data={data} />
  }

  if (data.type === 'sim_key') {
    // SecretReveal masks itself when there's no value, so a value-less tag (the
    // model's placeholder / persisted form) renders masked and a Sim-filled tag
    // reveals the key + copy button — no separate "redacted" flag needed.
    return <SecretReveal value={data.value} />
  }

  return null
}

function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  const detail = data.code ? `${data.message} (${data.code})` : data.message

  return <p className='text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>{detail}</p>
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { getSettingsHref } = useSettingsNavigation()
  const settingsPath = getSettingsHref({ section: 'billing' })
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'
  const canManageBilling = canManageWorkspaceBilling(hostContext, session?.user?.id)
  const unavailableMessage = hostContext.hostOrganizationId
    ? 'Contact an organization admin to manage this workspace’s usage limits.'
    : 'Only the workspace owner can manage this workspace’s usage limits.'

  return (
    <div className='rounded-2xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-950/20'>
      <div className='flex items-center gap-2'>
        <svg
          className='size-4 shrink-0 text-amber-600 dark:text-amber-400'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M8 1.5L1 14h14L8 1.5z'
            stroke='currentColor'
            strokeWidth='1.3'
            strokeLinejoin='round'
          />
          <path d='M8 6.5v3' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
          <circle cx='8' cy='11.5' r='0.75' fill='currentColor' />
        </svg>
        <span className='font-[500] text-amber-800 text-sm leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-amber-700/90 text-small leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      {canManageBilling ? (
        <a
          href={settingsPath}
          className='mt-2 inline-flex items-center gap-1 font-[500] text-amber-700 text-small underline decoration-dashed underline-offset-2 transition-colors hover-hover:text-amber-900 dark:text-amber-300 dark:hover-hover:text-amber-200'
        >
          {buttonLabel}
          <ArrowRight className='size-3' />
        </a>
      ) : (
        <p className='mt-2 font-[500] text-amber-700 text-small dark:text-amber-300'>
          {unavailableMessage}
        </p>
      )}
    </div>
  )
}
