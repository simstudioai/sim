import {
  computeMentionHighlightRanges,
  extractContextTokens,
  restoreSkillTriggerText,
  stripMentionTrigger,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

/** URI scheme for portable chip links (`[label](sim:kind/id)`). Custom so only
 *  our own links — never generic markdown — are parsed back into chips. */
const CHIP_LINK_SCHEME = 'sim'

/**
 * Every chip kind that carries a single stable identifier → the
 * {@link ChatContext} id field encoded in `sim:<kind>/<id>`. This is the one map
 * that drives BOTH serialization and parsing, so every chip — resource, skill,
 * integration, slash command — round-trips through the exact same mechanism by
 * its true id (not by name). `satisfies Partial<Record<ChatContext['kind'],
 * string>>` keeps it union-synced: rename a kind's id field and this stops
 * type-checking.
 *
 * Excluded kinds (`current_workflow`, `blocks`, `workflow_block`, `docs`) carry
 * no single portable id (an array / two ids / none) and degrade to plain text.
 */
const PORTABLE_KIND_TO_ID_FIELD = {
  table: 'tableId',
  file: 'fileId',
  folder: 'folderId',
  filefolder: 'fileFolderId',
  scheduledtask: 'scheduleId',
  knowledge: 'knowledgeId',
  past_chat: 'chatId',
  workflow: 'workflowId',
  logs: 'executionId',
  skill: 'skillId',
  integration: 'blockType',
  slash_command: 'command',
} as const satisfies Partial<Record<ChatContext['kind'], string>>

/**
 * The subset of {@link ChatContext} kinds that serialize to a portable
 * `sim:<kind>/<id>` markdown link.
 */
export type PortableKind = keyof typeof PORTABLE_KIND_TO_ID_FIELD

/**
 * Matches a portable chip markdown link: `[label](sim:kind/id)`.
 * - group 1: label (any non-`]` chars)
 * - group 2: kind (lowercase letters / underscores, e.g. `past_chat`)
 * - group 3: id (any non-`)` / non-whitespace chars)
 */
const CHIP_LINK_PATTERN = new RegExp(
  `\\[([^\\]]+)\\]\\(${CHIP_LINK_SCHEME}:([a-z_]+)\\/([^)\\s]+)\\)`,
  'g'
)

/**
 * Parsed result of a single portable chip markdown link, including the source
 * span so callers can rewrite the surrounding text.
 */
export interface ParsedChipLink {
  kind: PortableKind
  id: string
  label: string
  start: number
  end: number
}

/**
 * Type guard narrowing an arbitrary kind string to a {@link PortableKind}.
 */
function isPortableKind(kind: string): kind is PortableKind {
  return Object.hasOwn(PORTABLE_KIND_TO_ID_FIELD, kind)
}

/**
 * Reads the portable id off a context for its kind, or `undefined` when the
 * context isn't a portable kind. Centralizes the id-field lookup so the
 * `PORTABLE_KIND_TO_ID_FIELD` map stays the single source of truth.
 */
function getPortableId(context: ChatContext): string | undefined {
  if (!isPortableKind(context.kind)) return undefined
  const field = PORTABLE_KIND_TO_ID_FIELD[context.kind]
  const value = (context as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Serializes a context to a portable `[label](sim:kind/id)` markdown link.
 *
 * @param context - The chat context to serialize.
 * @returns The markdown link string, or `null` when the context isn't a
 *   portable kind or its id field is missing/empty.
 */
function serializeChipContext(context: ChatContext): string | null {
  if (!isPortableKind(context.kind)) return null
  const id = getPortableId(context)
  if (!id) return null
  return `[${context.label}](${CHIP_LINK_SCHEME}:${context.kind}/${id})`
}

/**
 * The textarea token to insert when re-creating a chip on paste. Delegates to
 * {@link extractContextTokens} so the per-kind prefix (skill EM-SPACE sentinel,
 * slash `/`, `@` for everything else) has a single source of truth. The `??`
 * fallback is unreachable for portable contexts (they always have a label and
 * are never `current_workflow`); it only satisfies the optional return type.
 */
export function chipDisplayToken(context: ChatContext): string {
  return extractContextTokens([context])[0] ?? `@${context.label}`
}

/**
 * Serializes a selected slice of input text for the clipboard.
 *
 * Reuses the overlay's exact tokenization
 * ({@link computeMentionHighlightRanges} over {@link extractContextTokens}) so
 * a chip that renders as a highlighted token is the one that gets converted.
 * Every portable chip — resource, skill, integration, slash command — becomes a
 * `[label](sim:kind/id)` markdown link carrying its true id. Only non-portable
 * tokens and the plain text around chips fall through {@link
 * restoreSkillTriggerText} (mapping any stray skill sentinel back to `/`).
 *
 * When there is nothing to convert the output is byte-identical to
 * `restoreSkillTriggerText(selectedText)`; for a selection with no skill
 * sentinels that equals the raw selection, letting callers detect "no change".
 *
 * @param selectedText - The raw selected substring from the textarea.
 * @param contexts - The currently selected contexts (mention sources).
 * @returns The clipboard-ready string.
 */
export function serializeSelectionForClipboard(
  selectedText: string,
  contexts: ChatContext[]
): string {
  const ranges = computeMentionHighlightRanges(selectedText, extractContextTokens(contexts))
  if (ranges.length === 0) return restoreSkillTriggerText(selectedText)

  let result = ''
  let lastIndex = 0

  for (const range of ranges) {
    if (range.start > lastIndex) {
      result += restoreSkillTriggerText(selectedText.slice(lastIndex, range.start))
    }

    const label = stripMentionTrigger(range.token)
    const matched = contexts.find((c) => c.label === label)
    const serialized = matched ? serializeChipContext(matched) : null
    result += serialized ?? restoreSkillTriggerText(range.token)

    lastIndex = range.end
  }

  if (lastIndex < selectedText.length) {
    result += restoreSkillTriggerText(selectedText.slice(lastIndex))
  }

  return result
}

/**
 * Parses all portable chip markdown links from a string, in source order.
 *
 * Pure string→data: never fetches or executes. Matches whose kind is not a
 * {@link PortableKind} are skipped so non-portable `sim:` shapes don't leak
 * into the chip pipeline.
 *
 * @param text - The text to scan (e.g. pasted clipboard content).
 * @returns Parsed links with their `start`/`end` source spans.
 */
export function parseChipLinks(text: string): ParsedChipLink[] {
  const links: ParsedChipLink[] = []
  const pattern = new RegExp(CHIP_LINK_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const [full, label, kind, id] = match
    if (!isPortableKind(kind)) continue
    links.push({
      kind,
      id,
      label,
      start: match.index,
      end: match.index + full.length,
    })
  }

  return links
}

/**
 * Reconstructs the exact {@link ChatContext} shape for a parsed chip link.
 *
 * The `switch` over the literal kind narrows the return so each branch builds
 * a fully-typed context with no cast.
 *
 * @param link - A link produced by {@link parseChipLinks}.
 * @returns The matching chat context.
 */
export function chipLinkToContext(link: ParsedChipLink): ChatContext {
  switch (link.kind) {
    case 'table':
      return { kind: 'table', tableId: link.id, label: link.label }
    case 'file':
      return { kind: 'file', fileId: link.id, label: link.label }
    case 'folder':
      return { kind: 'folder', folderId: link.id, label: link.label }
    case 'filefolder':
      return { kind: 'filefolder', fileFolderId: link.id, label: link.label }
    case 'scheduledtask':
      return { kind: 'scheduledtask', scheduleId: link.id, label: link.label }
    case 'knowledge':
      return { kind: 'knowledge', knowledgeId: link.id, label: link.label }
    case 'past_chat':
      return { kind: 'past_chat', chatId: link.id, label: link.label }
    case 'workflow':
      return { kind: 'workflow', workflowId: link.id, label: link.label }
    case 'logs':
      return { kind: 'logs', executionId: link.id, label: link.label }
    case 'skill':
      return { kind: 'skill', skillId: link.id, label: link.label }
    case 'integration':
      return { kind: 'integration', blockType: link.id, label: link.label }
    case 'slash_command':
      return { kind: 'slash_command', command: link.id, label: link.label }
  }
}
