'use client'

import type { MouseEvent } from 'react'
import { Icon } from '@sim/emcn/icon'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useParams, useRouter } from 'next/navigation'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/mention-chip.module.css'
import { mentionMark } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/mention-items'
import { MarkdownMention, type MentionAttrs } from '@/platform/lib/data/files/markdown'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { workspacePath } from '@/platform/lib/workspace-navigation'

/**
 * Where a mention leads, as legacy's chip routes it. A skill opens in the legacy Skills page, which
 * this app does not have; an integration names a block type, not a page, so it leads nowhere.
 */
function mentionHref(
  workspaceId: string,
  kind: string,
  id: string,
  legacyWorkspace: string
): string | null {
  const resource = encodeURIComponent(id)
  if (kind === 'file') return `${workspacePath(workspaceId, 'files')}/${resource}`
  if (kind === 'folder') return `${workspacePath(workspaceId, 'files')}?folderId=${resource}`
  if (kind === 'table') return `${workspacePath(workspaceId, 'tables')}/${resource}`
  if (kind === 'knowledge') return `${workspacePath(workspaceId, 'knowledge')}/${resource}`
  if (kind === 'workflow') return `${workspacePath(workspaceId, 'workflows')}/${resource}`
  if (kind === 'skill') return `${legacyWorkspace}/skills?skillId=${resource}`
  return null
}

/**
 * A mention as it reads in the document: the resource's mark and name, inline with the prose.
 * Cmd/Ctrl-click opens the resource where the editor allows navigation.
 */
function MentionChipView({ node, editor }: ReactNodeViewProps) {
  const router = useRouter()
  const params = useParams()
  const organization = useOrganization()
  const { kind, id, label } = node.attrs as MentionAttrs
  const mark = mentionMark(kind, id, label)
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined
  const href =
    editor.storage.mentionMenu?.navigable === true && workspaceId
      ? mentionHref(workspaceId, kind, id, legacyRoutes(organization).workspace(workspaceId))
      : null

  const open = (event: MouseEvent) => {
    if (!href || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    if (kind === 'skill') window.location.assign(href)
    else router.push(href)
  }

  return (
    <NodeViewWrapper as='span' title={label} onClick={href ? open : undefined}>
      <span className={styles.chip} data-mention-chip='' data-navigable={href ? true : undefined}>
        {mark &&
          ('name' in mark ? <Icon name={mark.name} /> : <Icon providerId={mark.providerId} />)}
        <span>{label}</span>
      </span>
    </NodeViewWrapper>
  )
}

/** The mention node with its chip view; the same schema and Markdown as the headless node. */
export const MentionChip = MarkdownMention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView)
  },
})
