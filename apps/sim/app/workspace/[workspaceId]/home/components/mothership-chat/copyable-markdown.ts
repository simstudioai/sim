import type { ClipboardContent } from '@sim/emcn'
import { toSimMarkdownLink } from '@/lib/copilot/sim-link'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import {
  appendInlineReferenceMarkdown,
  workspaceResourceLabel,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/workspace-resource-markdown'
import {
  parseSpecialTags,
  type WorkspaceResourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'

interface PortableWorkspaceResourceMarkdown {
  markdown: string
  hasUnresolvedFile: boolean
}

export interface WorkspaceResourceNames {
  workflow?: ReadonlyMap<string, string>
  table?: ReadonlyMap<string, string>
}

function portableWorkspaceResourceMarkdown(
  data: WorkspaceResourceTagData,
  workspaceFiles: readonly WorkspaceFileRecord[],
  resourceNames: WorkspaceResourceNames
): PortableWorkspaceResourceMarkdown {
  const label = workspaceResourceLabel(data)
  const resource = resolveWorkspaceResourceRef({ ...data, title: data.title ?? '' }, workspaceFiles)
  const cachedLabel =
    resource && data.type !== 'file' ? resourceNames[data.type]?.get(resource.id) : undefined
  const resolvedLabel = cachedLabel ?? resource?.title
  return {
    markdown: resource
      ? toSimMarkdownLink(resource.type, resource.id, resolvedLabel || label)
      : label,
    hasUnresolvedFile: data.type === 'file' && !resource,
  }
}

export interface CopyableMarkdownResult {
  markdown: string
  hasUnresolvedFile: boolean
}

export function serializeCopyableMarkdown(
  raw: string,
  workspaceFiles: readonly WorkspaceFileRecord[] = [],
  resourceNames: WorkspaceResourceNames = {}
): CopyableMarkdownResult {
  const displayContent = sanitizeChatDisplayContent(raw)
  const { segments } = parseSpecialTags(displayContent, false)
  let hasUnresolvedFile = false

  const markdown = segments
    .reduce((markdown, segment, index) => {
      if (segment.type === 'text') return markdown + segment.content
      if (segment.type === 'workspace_resource') {
        const portable = portableWorkspaceResourceMarkdown(
          segment.data,
          workspaceFiles,
          resourceNames
        )
        hasUnresolvedFile ||= portable.hasUnresolvedFile
        return appendInlineReferenceMarkdown(markdown, portable.markdown, segments[index + 1])
      }
      return markdown
    }, '')
    .trim()

  return { markdown, hasUnresolvedFile }
}

export function toCopyableMarkdown(
  raw: string,
  workspaceFiles: readonly WorkspaceFileRecord[] = [],
  resourceNames: WorkspaceResourceNames = {}
): string {
  return serializeCopyableMarkdown(raw, workspaceFiles, resourceNames).markdown
}

export function prepareCopyableMarkdown(
  raw: string,
  workspaceFiles: readonly WorkspaceFileRecord[],
  refreshWorkspaceFiles: () => Promise<readonly WorkspaceFileRecord[]>,
  resourceNames: WorkspaceResourceNames = {}
): ClipboardContent {
  const initial = serializeCopyableMarkdown(raw, workspaceFiles, resourceNames)
  if (!initial.hasUnresolvedFile) return initial.markdown

  return {
    fallback: initial.markdown,
    prepare: () =>
      refreshWorkspaceFiles()
        .catch(() => workspaceFiles)
        .then((refreshedFiles) => toCopyableMarkdown(raw, refreshedFiles, resourceNames)),
  }
}
