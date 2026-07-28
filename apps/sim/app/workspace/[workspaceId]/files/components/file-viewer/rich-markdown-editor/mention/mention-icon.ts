import type { ComponentType } from 'react'
import { Database, Folder, Table, Workflow } from '@sim/emcn/icons'
import { AgentSkillsIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { getBlock } from '@/blocks/registry'
import type { MentionKind } from './types'

/** Icon component shape both the kind icons and the brand block icons satisfy. */
export type MentionIcon = ComponentType<{ className?: string }>

/**
 * The glyph each mention kind uses elsewhere in the product, so a mention reads
 * as the resource it links to. Mirrors `CHAT_CONTEXT_KIND_REGISTRY`, the same
 * mapping Chat's `@` menu renders.
 */
const KIND_ICONS: Record<Exclude<MentionKind, 'integration' | 'file'>, MentionIcon> = {
  folder: Folder,
  table: Table,
  knowledge: Database,
  workflow: Workflow,
  skill: AgentSkillsIcon,
}

/**
 * Resolves the icon for a mention:
 *
 * - `integration` uses the block's brand icon from the registry, keyed by the
 *   mention `id` (the blockType).
 * - `file` uses the extension-derived document icon, so a `.pdf` and a `.csv`
 *   look different — matching the file list and Chat's context chips.
 * - every other kind uses its product-wide glyph.
 *
 * Returns `undefined` when nothing sensible applies — an unrecognized kind (the
 * node schema defaults `kind` to `''`, and a hand-written `sim:` link can carry
 * anything) or a block that has since been removed. Callers render no icon in
 * that case rather than a meaningless placeholder, which is what the chat
 * context registry does too.
 */
export function mentionIcon(kind: MentionKind, id: string, label = ''): MentionIcon | undefined {
  if (kind === 'integration') return getBlock(id)?.icon as MentionIcon | undefined
  if (kind === 'file') return getDocumentIcon('', label)
  return KIND_ICONS[kind as Exclude<MentionKind, 'integration' | 'file'>]
}
