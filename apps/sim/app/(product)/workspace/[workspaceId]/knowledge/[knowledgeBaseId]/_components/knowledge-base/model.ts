import type { IconName } from '@sim/emcn/icon'
import { workspacePath } from '@/lib/navigation/paths'
import type { DocumentData } from '@/platform/lib/data/knowledge'
import { platformHref } from '@/platform/lib/navigation'

interface SearchValues {
  get(key: string): string | null
}

/** The Knowledge bases list, opened at a folder or at its root. */
export function knowledgeListHref(
  workspaceId: string,
  folderId: string | null,
  search: SearchValues
) {
  const list = workspacePath(workspaceId, 'knowledge')
  return platformHref(folderId ? `${list}?${new URLSearchParams({ folderId })}` : list, search)
}

/** A knowledge base's documents. */
export function knowledgeBaseHref(
  workspaceId: string,
  knowledgeBaseId: string,
  search: SearchValues
) {
  return platformHref(
    `${workspacePath(workspaceId, 'knowledge')}/${encodeURIComponent(knowledgeBaseId)}`,
    search
  )
}

/** A document's chunks, optionally opened at one chunk. */
export function documentHref(
  workspaceId: string,
  knowledgeBaseId: string,
  documentId: string,
  search: SearchValues,
  chunkId?: string
) {
  const path = `${workspacePath(workspaceId, 'knowledge')}/${encodeURIComponent(knowledgeBaseId)}/${encodeURIComponent(documentId)}`
  return platformHref(chunkId ? `${path}?${new URLSearchParams({ chunk: chunkId })}` : path, search)
}

/** An image reads as one; every other document as a file. */
export function documentIcon(document: Pick<DocumentData, 'mimeType'>): IconName {
  return document.mimeType.startsWith('image/') ? 'I059' : 'I015'
}

/** Thousands read as `1.2k`, as the legacy list shows them. */
export function formatTokens(count: number) {
  return count > 1000 ? `${(count / 1000).toFixed(1)}k` : count.toLocaleString()
}

/** A chunk's token count: `1.2K` from a thousand, `1.2M` from a million. */
export function formatTokenCount(count: number) {
  if (count < 1000) return count.toString()
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** A connector's brand mark: the design system names its providers with underscores. */
export function connectorMark(connectorType: string) {
  return connectorType.replaceAll('-', '_')
}

export const CONNECTOR_STATUS: Record<
  string,
  { label: string; intent: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  active: { label: 'Active', intent: 'success' },
  pending: { label: 'Queued', intent: 'info' },
  syncing: { label: 'Syncing', intent: 'warning' },
  error: { label: 'Error', intent: 'danger' },
  paused: { label: 'Paused', intent: 'neutral' },
  disabled: { label: 'Disabled', intent: 'warning' },
}
