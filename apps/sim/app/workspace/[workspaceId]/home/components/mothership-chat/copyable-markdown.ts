import type { ClipboardContent } from '@sim/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import {
  type ContentSegment,
  parseSpecialTags,
  type WorkspaceResourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { serializePortableChipLink } from '@/app/workspace/[workspaceId]/home/components/user-input/components/chip-clipboard-codec'
import { resolveWorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'

interface CopyableMarkdownResult {
  markdown: string
  hasUnresolvedFile: boolean
}

function workspaceResourceLabel(data: WorkspaceResourceTagData): string {
  if (data.title) return data.title
  return data.type === 'file' ? (data.path ?? data.id ?? '') : (data.id ?? '')
}

function appendInlineReferenceMarkdown(
  currentMarkdown: string,
  referenceMarkdown: string,
  nextSegment?: ContentSegment
): string {
  const followingText =
    nextSegment?.type === 'text'
      ? nextSegment.content
      : nextSegment?.type === 'workspace_resource'
        ? nextSegment.data.title || nextSegment.data.id || ''
        : ''
  const leadingSpace = /[A-Za-z0-9_)]$/.test(currentMarkdown) ? ' ' : ''
  const trailingSpace =
    /^[A-Za-z0-9_(]/.test(followingText) && !/\s$/.test(referenceMarkdown) ? ' ' : ''
  return `${currentMarkdown}${leadingSpace}${referenceMarkdown}${trailingSpace}`
}

function portableWorkspaceResourceMarkdown(
  data: WorkspaceResourceTagData,
  workspaceFiles: readonly WorkspaceFileRecord[]
): CopyableMarkdownResult {
  const label = workspaceResourceLabel(data)
  const resource = resolveWorkspaceResourceRef({ ...data, title: data.title ?? '' }, workspaceFiles)
  return {
    markdown: resource
      ? serializePortableChipLink(data.type, resource.id, resource.title || label)
      : label,
    hasUnresolvedFile: data.type === 'file' && !resource,
  }
}

function serializeCopyableMarkdown(
  raw: string,
  workspaceFiles: readonly WorkspaceFileRecord[] = []
): CopyableMarkdownResult {
  const displayContent = sanitizeChatDisplayContent(raw)
  const { segments } = parseSpecialTags(displayContent, false)
  let hasUnresolvedFile = false

  const markdown = segments
    .reduce((markdown, segment, index) => {
      if (segment.type === 'text') return markdown + segment.content
      if (segment.type === 'workspace_resource') {
        const portable = portableWorkspaceResourceMarkdown(segment.data, workspaceFiles)
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
  workspaceFiles: readonly WorkspaceFileRecord[] = []
): string {
  return serializeCopyableMarkdown(raw, workspaceFiles).markdown
}

export function prepareCopyableMarkdown(
  raw: string,
  workspaceFiles: readonly WorkspaceFileRecord[],
  refreshWorkspaceFiles: () => Promise<readonly WorkspaceFileRecord[]>
): ClipboardContent {
  const initial = serializeCopyableMarkdown(raw, workspaceFiles)
  if (!initial.hasUnresolvedFile) return initial.markdown

  return {
    fallback: initial.markdown,
    prepare: async () => {
      try {
        return toCopyableMarkdown(raw, await refreshWorkspaceFiles())
      } catch {
        return initial.markdown
      }
    },
  }
}
