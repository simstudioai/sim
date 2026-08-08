import { sanitize } from '../../output/render.js'

export const OFFICIAL_CHAT_TAG_NAMES = [
  'thinking',
  'options',
  'question',
  'credential',
  'workspace_resource',
  'usage_upgrade',
  'mothership-error',
] as const

export type OfficialChatTagName = (typeof OFFICIAL_CHAT_TAG_NAMES)[number]

export interface ChatChoice {
  value: string
  label: string
  description: string
}

export interface ChatQuestionOption {
  id: string
  label: string
}

export interface ChatQuestion {
  type: 'single_select' | 'multi_select'
  prompt: string
  options: ChatQuestionOption[]
}

export interface ChatOptionsInteraction {
  kind: 'options'
  choices: ChatChoice[]
}

export interface ChatQuestionInteraction {
  kind: 'question'
  questions: ChatQuestion[]
}

export type ChatInteraction = ChatOptionsInteraction | ChatQuestionInteraction

export type ChatCredentialType =
  | 'env_key'
  | 'oauth_key'
  | 'sim_key'
  | 'credential_id'
  | 'link'
  | 'secret_input'
  | 'folder_access'
  | 'browser_takeover'
  | 'terminal_handoff'
  | 'service_account'

export interface ChatCredential {
  type: ChatCredentialType
  provider?: string
  value?: string
  name?: string
  scope?: 'personal' | 'workspace'
  credentialId?: string
}

export interface ChatWorkspaceResource {
  type: 'workflow' | 'table' | 'file'
  id?: string
  path?: string
  title?: string
}

export interface ChatUsageUpgrade {
  reason: string
  action: 'upgrade_plan' | 'increase_limit'
  message: string
}

export interface ChatMothershipError {
  message: string
  code?: string
  provider?: string
}

export type ChatStructuredSegment =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'options'; choices: ChatChoice[] }
  | { kind: 'question'; questions: ChatQuestion[] }
  | { kind: 'credential'; credential: ChatCredential }
  | { kind: 'workspace_resource'; resource: ChatWorkspaceResource }
  | { kind: 'usage_upgrade'; upgrade: ChatUsageUpgrade }
  | { kind: 'mothership-error'; error: ChatMothershipError }

export interface ChatStructuredRenderOptions {
  printMode?: boolean
}

export interface ChatStructuredRenderResult {
  text: string
  interactions: ChatInteraction[]
  /**
   * The parts `text` was joined from, each tagged block or inline.
   *
   * Exposed so an incremental renderer can reuse this classification instead of
   * re-deriving it per segment kind — two copies of that rule drift apart and
   * nothing catches it, since only one of them is exercised by the one-shot path.
   */
  parts: readonly RenderPart[]
}

interface OpeningTagMatch {
  index: number
  name: OfficialChatTagName
}

export interface RenderPart {
  block: boolean
  value: string
}

type JsonRecord = Record<string, unknown>

const OPENING_TAGS = OFFICIAL_CHAT_TAG_NAMES.map((name) => ({
  marker: `<${name}>`,
  name,
}))

const QUESTION_TYPES = new Set(['single_select', 'multi_select'])
const MAX_QUESTIONS = 3
const MAX_QUESTION_OPTIONS = 20
const MAX_QUESTION_PROMPT_LENGTH = 1024
const MAX_QUESTION_OPTION_FIELD_LENGTH = 160
const CREDENTIAL_TYPES = new Set<ChatCredentialType>([
  'env_key',
  'oauth_key',
  'sim_key',
  'credential_id',
  'link',
  'secret_input',
  'folder_access',
  'browser_takeover',
  'terminal_handoff',
  'service_account',
])
const QUESTION_CATCH_ALL_LABELS = new Set([
  'other',
  'others',
  'something else',
  'none of the above',
  'none of these',
])
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

/** Sanitizes one server-owned fragment before it enters parser state. */
function sanitizeServerString(value: string): string {
  return sanitize(value).replace(/\r/g, '')
}

function oneLine(value: string): string {
  return sanitizeServerString(value)
    .replace(/[\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? sanitizeServerString(value) : undefined
}

function parseJson(body: string): unknown | undefined {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function parseChoices(value: unknown): ChatChoice[] | null {
  if (value === null || typeof value !== 'object') return null

  const choices: ChatChoice[] = []
  for (const item of Object.values(value)) {
    if (!isRecord(item) || typeof item.title !== 'string' || typeof item.description !== 'string') {
      return null
    }
    const title = oneLine(item.title)
    choices.push({
      value: title,
      label: title,
      description: oneLine(item.description),
    })
  }
  return choices
}

function parseQuestion(value: unknown): ChatQuestion | null {
  if (!isRecord(value) || !QUESTION_TYPES.has(String(value.type))) return null
  if (typeof value.prompt !== 'string') return null

  const prompt = oneLine(value.prompt)
  if (
    !prompt ||
    prompt.length > MAX_QUESTION_PROMPT_LENGTH ||
    !Array.isArray(value.options) ||
    value.options.length === 0 ||
    value.options.length > MAX_QUESTION_OPTIONS
  ) {
    return null
  }

  const options: ChatQuestionOption[] = []
  for (const option of value.options) {
    if (!isRecord(option) || typeof option.id !== 'string' || typeof option.label !== 'string') {
      return null
    }
    const id = oneLine(option.id)
    const label = oneLine(option.label)
    if (
      !id ||
      !label ||
      id.length > MAX_QUESTION_OPTION_FIELD_LENGTH ||
      label.length > MAX_QUESTION_OPTION_FIELD_LENGTH
    ) {
      return null
    }
    if (QUESTION_CATCH_ALL_LABELS.has(label.trim().toLowerCase())) continue
    options.push({ id, label })
  }
  if (options.length === 0) return null

  return {
    type: value.type as ChatQuestion['type'],
    prompt,
    options,
  }
}

function parseQuestions(value: unknown): ChatQuestion[] | null {
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0 || values.length > MAX_QUESTIONS) return null

  const questions: ChatQuestion[] = []
  for (const candidate of values) {
    const question = parseQuestion(candidate)
    if (!question) return null
    questions.push(question)
  }
  return questions
}

function recoverQuestionPrompts(body: string): string | null {
  const payload = parseJson(body)
  if (payload === undefined) return null

  const values = (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_QUESTIONS)
  const prompts: string[] = []
  for (const value of values) {
    if (!isRecord(value) || typeof value.prompt !== 'string') continue
    const prompt = oneLine(value.prompt)
    if (prompt && prompt.length <= MAX_QUESTION_PROMPT_LENGTH) prompts.push(prompt)
  }
  return prompts.length > 0 ? prompts.join('\n\n') : null
}

function parseCredential(value: unknown): ChatCredential | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (!CREDENTIAL_TYPES.has(value.type as ChatCredentialType)) return null
  if (value.provider !== undefined && typeof value.provider !== 'string') return null

  const type = value.type as ChatCredentialType
  const provider = cleanOptionalString(value.provider)

  if (type === 'secret_input') {
    if (typeof value.name !== 'string' || !sanitizeServerString(value.name).trim()) return null
    if (value.scope !== undefined && value.scope !== 'personal' && value.scope !== 'workspace') {
      return null
    }
    return {
      type,
      provider,
      name: sanitizeServerString(value.name),
      scope: value.scope as ChatCredential['scope'],
    }
  }

  if (type === 'folder_access' || type === 'browser_takeover' || type === 'terminal_handoff') {
    if (value.name !== undefined && typeof value.name !== 'string') return null
    return { type, provider, name: cleanOptionalString(value.name) }
  }

  if (type === 'service_account') {
    if (!provider?.trim()) return null
    if (
      value.credentialId !== undefined &&
      (typeof value.credentialId !== 'string' || !sanitizeServerString(value.credentialId).trim())
    ) {
      return null
    }
    return {
      type,
      provider,
      credentialId: cleanOptionalString(value.credentialId),
    }
  }

  if (type === 'sim_key') return { type, provider }
  if (typeof value.value !== 'string') return null
  if (type === 'link' && TERMINAL_CONTROL_PATTERN.test(value.value)) return null
  return { type, provider, value: sanitizeServerString(value.value) }
}

function cleanLinkIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' || TERMINAL_CONTROL_PATTERN.test(value)) return undefined
  const cleaned = sanitizeServerString(value).trim()
  return cleaned || undefined
}

function parseWorkspaceResource(value: unknown): ChatWorkspaceResource | null {
  if (
    !isRecord(value) ||
    (value.type !== 'workflow' && value.type !== 'table' && value.type !== 'file')
  ) {
    return null
  }
  if (value.id !== undefined && typeof value.id !== 'string') return null
  if (value.path !== undefined && typeof value.path !== 'string') return null
  if (value.title !== undefined && typeof value.title !== 'string') return null

  const id = cleanLinkIdentifier(value.id)
  const path = cleanLinkIdentifier(value.path)
  if ((value.type === 'workflow' || value.type === 'table') && !id) return null
  if (value.type === 'file' && !id && !path) return null

  return {
    type: value.type,
    id,
    path,
    title: cleanOptionalString(value.title),
  }
}

function parseUsageUpgrade(value: unknown): ChatUsageUpgrade | null {
  if (!isRecord(value)) return null
  if (typeof value.reason !== 'string' || typeof value.message !== 'string') return null
  if (value.action !== 'upgrade_plan' && value.action !== 'increase_limit') return null
  return {
    reason: sanitizeServerString(value.reason),
    action: value.action,
    message: sanitizeServerString(value.message),
  }
}

function parseMothershipError(value: unknown): ChatMothershipError | null {
  if (!isRecord(value) || typeof value.message !== 'string') return null
  if (value.code !== undefined && typeof value.code !== 'string') return null
  if (value.provider !== undefined && typeof value.provider !== 'string') return null
  return {
    message: sanitizeServerString(value.message),
    code: cleanOptionalString(value.code),
    provider: cleanOptionalString(value.provider),
  }
}

function parseTag(name: OfficialChatTagName, body: string): ChatStructuredSegment | null {
  if (name === 'thinking') {
    return body.trim() ? { kind: 'thinking', content: sanitizeServerString(body) } : null
  }

  const payload = parseJson(body)
  if (payload === undefined) return null

  if (name === 'options') {
    const choices = parseChoices(payload)
    return choices ? { kind: 'options', choices } : null
  }
  if (name === 'question') {
    const questions = parseQuestions(payload)
    return questions ? { kind: 'question', questions } : null
  }
  if (name === 'credential') {
    const credential = parseCredential(payload)
    return credential ? { kind: 'credential', credential } : null
  }
  if (name === 'workspace_resource') {
    const resource = parseWorkspaceResource(payload)
    return resource ? { kind: 'workspace_resource', resource } : null
  }
  if (name === 'usage_upgrade') {
    const upgrade = parseUsageUpgrade(payload)
    return upgrade ? { kind: 'usage_upgrade', upgrade } : null
  }

  const error = parseMothershipError(payload)
  return error ? { kind: 'mothership-error', error } : null
}

function invalidTagFallback(
  name: OfficialChatTagName,
  body?: string
): ChatStructuredSegment | null {
  if (name === 'thinking') return null
  if (name === 'credential') {
    return { kind: 'text', text: 'Open Sim to complete the requested credential action.' }
  }
  // Keep an internal empty marker so renderers can discard whitespace that was
  // emitted before a malformed or incomplete suggestions wrapper. The marker
  // itself still renders as nothing and never becomes an interaction.
  if (name === 'options') return { kind: 'options', choices: [] }
  if (name === 'question') {
    return {
      kind: 'text',
      text:
        (body === undefined ? null : recoverQuestionPrompts(body)) ??
        'Sim Chat requested an interactive response.',
    }
  }
  if (name === 'workspace_resource') {
    return { kind: 'text', text: 'Sim Chat referenced a workspace resource.' }
  }
  if (name === 'usage_upgrade') return { kind: 'text', text: 'Usage limit reached.' }
  return { kind: 'text', text: 'Sim Chat reported an error.' }
}

function nextMarkdownDelimiter(value: string, initialDelimiter: number): number {
  let delimiter = initialDelimiter
  let index = 0
  while (index < value.length) {
    if (value[index] !== '`') {
      index += 1
      continue
    }
    let end = index + 1
    while (end < value.length && value[end] === '`') end += 1
    const runLength = end - index
    if (delimiter === 0) delimiter = runLength
    else if (runLength >= delimiter) delimiter = 0
    index = end
  }
  return delimiter
}

function findOpeningTag(value: string, initialDelimiter: number): OpeningTagMatch | null {
  let delimiter = initialDelimiter
  let index = 0
  while (index < value.length) {
    if (value[index] === '`') {
      let end = index + 1
      while (end < value.length && value[end] === '`') end += 1
      const runLength = end - index
      if (delimiter === 0) delimiter = runLength
      else if (runLength >= delimiter) delimiter = 0
      index = end
      continue
    }

    if (delimiter === 0 && value[index] === '<') {
      for (const opening of OPENING_TAGS) {
        if (value.startsWith(opening.marker, index)) return { index, name: opening.name }
      }
    }
    index += 1
  }
  return null
}

function findClosingTag(value: string, start: number, name: OfficialChatTagName): number {
  const closing = `</${name}>`
  if (name === 'thinking') return value.indexOf(closing, start)

  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (value.startsWith(closing, index)) return index
  }
  return -1
}

function trailingBacktickRun(value: string): number {
  let index = value.length
  while (index > 0 && value[index - 1] === '`') index -= 1
  return value.length - index
}

function partialOpeningSuffix(value: string): number {
  let longest = 0
  for (const { marker } of OPENING_TAGS) {
    const limit = Math.min(marker.length - 1, value.length)
    for (let length = limit; length > longest; length -= 1) {
      if (value.endsWith(marker.slice(0, length))) {
        longest = length
        break
      }
    }
  }
  return longest
}

function appendText(segments: ChatStructuredSegment[], text: string): void {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous?.kind === 'text') previous.text += text
  else segments.push({ kind: 'text', text })
}

/**
 * Incrementally parses structured Sim Chat tags while retaining possible openers
 * and incomplete wrappers across arbitrary transport chunk boundaries.
 */
export class ChatStructuredParser {
  private buffer = ''
  private markdownDelimiter = 0
  private finished = false

  push(fragment: string): ChatStructuredSegment[] {
    if (this.finished) throw new Error('Cannot push to a finished chat parser.')
    this.buffer += sanitizeServerString(fragment)
    return this.drain(false)
  }

  finish(): ChatStructuredSegment[] {
    if (this.finished) return []
    this.finished = true
    return this.drain(true)
  }

  private consumeText(length: number, segments: ChatStructuredSegment[]): void {
    const text = this.buffer.slice(0, length)
    this.buffer = this.buffer.slice(length)
    this.markdownDelimiter = nextMarkdownDelimiter(text, this.markdownDelimiter)
    appendText(segments, text)
  }

  private drain(final: boolean): ChatStructuredSegment[] {
    const segments: ChatStructuredSegment[] = []

    while (this.buffer) {
      const opening = findOpeningTag(this.buffer, this.markdownDelimiter)
      if (!opening) {
        const retained = final
          ? 0
          : Math.max(partialOpeningSuffix(this.buffer), trailingBacktickRun(this.buffer))
        const consumable = this.buffer.length - retained
        if (consumable > 0) this.consumeText(consumable, segments)
        break
      }

      if (opening.index > 0) {
        this.consumeText(opening.index, segments)
        continue
      }

      const openingMarker = `<${opening.name}>`
      const closingMarker = `</${opening.name}>`
      const closingIndex = findClosingTag(this.buffer, openingMarker.length, opening.name)
      if (closingIndex === -1) {
        if (final) {
          if (opening.name === 'thinking') {
            // Thinking is intentionally hidden from terminal output. If the stream
            // ends before the wrapper closes, fail closed instead of exposing its
            // potentially private contents as ordinary text.
            this.buffer = ''
          } else {
            const body = this.buffer.slice(openingMarker.length)
            this.buffer = ''
            const fallback = invalidTagFallback(opening.name, body)
            if (fallback) segments.push(fallback)
          }
        }
        break
      }

      const end = closingIndex + closingMarker.length
      const body = this.buffer.slice(openingMarker.length, closingIndex)
      const parsed = parseTag(opening.name, body)
      if (!parsed) {
        this.buffer = this.buffer.slice(end)
        const fallback = invalidTagFallback(opening.name, body)
        if (fallback) segments.push(fallback)
        continue
      }

      this.buffer = this.buffer.slice(end)
      segments.push(parsed)
    }

    return segments
  }
}

/** Parses a completed Sim Chat response into sanitized structured segments. */
export function parseChatStructured(content: string): ChatStructuredSegment[] {
  const parser = new ChatStructuredParser()
  return [...parser.push(content), ...parser.finish()]
}

function resourceLabel(resource: ChatWorkspaceResource): string {
  const title = oneLine(resource.title ?? '')
  if (title) return title
  if (resource.type === 'file') return oneLine(resource.path ?? resource.id ?? 'File') || 'File'
  return resource.type === 'workflow' ? 'Workflow' : 'Table'
}

function renderResource(resource: ChatWorkspaceResource): string {
  return resourceLabel(resource)
}

function renderCredential(credential: ChatCredential): string {
  const provider = oneLine(credential.provider ?? '') || 'account'
  const name = oneLine(credential.name ?? '')

  if (credential.type === 'link' && credential.value) {
    return `Open Sim to connect ${provider}.`
  }
  if (credential.type === 'service_account') {
    return `Open Sim to connect ${provider} with a service account.`
  }
  if (credential.type === 'secret_input') {
    return `Open Sim to provide ${name || 'the requested secret'}.`
  }
  if (credential.type === 'folder_access') {
    return `Open Sim Desktop to grant access to ${name || 'the requested folder'}.`
  }
  if (credential.type === 'browser_takeover') {
    return `Open Sim Desktop to continue ${name || 'the browser task'}.`
  }
  if (credential.type === 'terminal_handoff') {
    return `Open Sim Desktop to continue ${name || 'the terminal task'}.`
  }
  if (credential.type === 'env_key') {
    return `Open Sim to configure ${provider} environment credentials.`
  }
  if (credential.type === 'oauth_key') return `Open Sim to connect ${provider} with OAuth.`
  if (credential.type === 'credential_id') return `Open Sim to select ${provider} credentials.`
  if (credential.type === 'sim_key') return 'Open Sim to configure a Sim API key.'
  return `Open Sim to configure ${provider} credentials.`
}

function renderQuestions(questions: ChatQuestion[]): string {
  return questions.map((question) => oneLine(question.prompt)).join('\n\n')
}

function addPart(parts: RenderPart[], value: string, block: boolean): void {
  if (value) parts.push({ block, value: sanitizeServerString(value) })
}

function trimRenderedEnd(parts: RenderPart[]): void {
  while (parts.length > 0) {
    const last = parts[parts.length - 1]
    last.value = last.value.trimEnd()
    if (last.value) return
    parts.pop()
  }
}

function joinRenderParts(parts: RenderPart[]): string {
  let output = ''
  let previous: RenderPart | undefined
  for (const part of parts) {
    if (output && (part.block || previous?.block)) {
      const trailing = output.match(/\n*$/u)?.[0].length ?? 0
      const leading = part.value.match(/^\n*/u)?.[0].length ?? 0
      output += '\n'.repeat(Math.max(0, 2 - trailing - leading))
    }
    output += part.value
    previous = part
  }
  return output
}

/**
 * Renders structured chat as deterministic terminal-safe text.
 */
export function renderChatStructured(
  input: string | readonly ChatStructuredSegment[],
  options: ChatStructuredRenderOptions = {}
): ChatStructuredRenderResult {
  const segments = typeof input === 'string' ? parseChatStructured(input) : input
  const printMode = options.printMode !== false
  const parts: RenderPart[] = []
  const interactions: ChatInteraction[] = []
  let strippedOptions = false

  for (const segment of segments) {
    if (segment.kind === 'text') {
      const text = strippedOptions ? segment.text.replace(/^\s+/u, '') : segment.text
      if (strippedOptions && !text) continue
      strippedOptions = false
      addPart(parts, text, false)
      continue
    }
    if (segment.kind === 'thinking') continue
    if (segment.kind === 'workspace_resource') {
      addPart(parts, renderResource(segment.resource), false)
      continue
    }
    if (segment.kind === 'options') {
      // Follow-up suggestions are browser UI metadata, not answer text. The
      // terminal composer stays ordinary free-form input, so omit them fully.
      trimRenderedEnd(parts)
      strippedOptions = true
      continue
    }
    strippedOptions = false
    if (segment.kind === 'question') {
      const questions = segment.questions.map((question) => ({
        type: question.type,
        prompt: oneLine(question.prompt),
        options: question.options.map((option) => ({
          id: oneLine(option.id),
          label: oneLine(option.label),
        })),
      }))
      interactions.push({ kind: 'question', questions })
      if (printMode) addPart(parts, renderQuestions(questions), true)
      continue
    }
    if (segment.kind === 'credential') {
      addPart(parts, renderCredential(segment.credential), true)
      continue
    }
    if (segment.kind === 'usage_upgrade') {
      addPart(parts, `Usage limit reached: ${oneLine(segment.upgrade.message)}`, true)
      continue
    }
    addPart(
      parts,
      `${oneLine(segment.error.message)}${segment.error.code ? ` (${oneLine(segment.error.code)})` : ''}`,
      true
    )
  }

  return { text: joinRenderParts(parts), interactions, parts }
}
