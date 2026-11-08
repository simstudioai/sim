import { providerMarkIds } from '@sim/emcn/icon/provider-mark-ids.generated'
import type { SuggestionMark } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-list'
import { BLOCK_NAMES, type MentionItem, type MentionKind } from '@/platform/lib/data/files/markdown'

const KIND_MARKS: Partial<Record<MentionKind, SuggestionMark>> = {
  folder: { name: 'I100' },
  table: { name: 'I033' },
  knowledge: { name: 'I004' },
  workflow: { name: 'I118' },
  skill: { name: 'I127' },
}

const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg|heic|heif)$/i
const PROVIDER_MARKS: ReadonlySet<string> = new Set(providerMarkIds)

/** The mark a mention reads as: its integration's brand, or the glyph of the resource it links. */
export function mentionMark(kind: string, id: string, label = ''): SuggestionMark | undefined {
  if (kind === 'integration') {
    const base = id.replace(/_v\d+$/, '')
    return { providerId: PROVIDER_MARKS.has(base) || !PROVIDER_MARKS.has(id) ? base : id }
  }
  if (kind === 'file') return { name: IMAGE_NAME.test(label) ? 'I059' : 'I015' }
  return KIND_MARKS[kind as MentionKind]
}

/** Strips ` (Legacy)` and ` V2` suffixes, as legacy's integration list names a block. */
function displayName(name: string): string {
  return name
    .replace(/\s*\(legacy\)\s*$/i, '')
    .replace(/\s+v\d+(\.\d+)*\s*$/i, '')
    .trim()
}

/**
 * The integrations a mention can name: every block with a provider mark, one per display name, in
 * name order, as legacy's `@` menu lists them. The id is the block type, as legacy mentions carry it.
 */
export const INTEGRATION_MENTIONS: readonly MentionItem[] = (() => {
  const byName = new Map<string, MentionItem>()
  for (const [type, name] of Object.entries(BLOCK_NAMES)) {
    if (!PROVIDER_MARKS.has(type) && !PROVIDER_MARKS.has(type.replace(/_v\d+$/, ''))) continue
    const label = displayName(name)
    const key = label.toLowerCase()
    if (label.length < 2 || byName.has(key)) continue
    byName.set(key, { kind: 'integration', id: type, label, group: 'Integrations' })
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label))
})()
