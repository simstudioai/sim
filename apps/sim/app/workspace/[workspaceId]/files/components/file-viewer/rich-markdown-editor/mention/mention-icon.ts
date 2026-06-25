import type { ComponentType } from 'react'
import { Database, File, Folder, Sparkles, Table, Workflow } from 'lucide-react'
import { getBlock } from '@/blocks/registry'
import type { MentionKind } from './types'

/** Icon component shape both the lucide kind-icons and the brand block icons satisfy. */
export type MentionIcon = ComponentType<{ className?: string }>

const KIND_ICONS: Record<Exclude<MentionKind, 'integration'>, MentionIcon> = {
  file: File,
  folder: Folder,
  table: Table,
  knowledge: Database,
  workflow: Workflow,
  skill: Sparkles,
}

/**
 * Resolves the icon for a mention. Integrations use their brand icon from the block registry (keyed by
 * blockType, which is the mention `id`); every other kind uses a lucide category icon. Shared by the
 * menu rows and the inserted chip so both render the same icon.
 */
export function mentionIcon(kind: MentionKind, id: string): MentionIcon | undefined {
  if (kind === 'integration') return getBlock(id)?.icon as MentionIcon | undefined
  return KIND_ICONS[kind]
}
