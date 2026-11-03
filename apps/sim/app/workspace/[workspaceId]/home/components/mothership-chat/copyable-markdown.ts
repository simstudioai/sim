import type { ClipboardContent } from '@sim/emcn'
import type { MothershipResource, WorkspaceResourceRef } from '@/lib/mothership/resources/types'
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

/**
 * Resolves a chip to the resource it addresses: the resource, `null` when nothing answers to it,
 * or `undefined` when that is not known yet. Either way an unresolved chip is copied as plain text.
 */
type ResolveResourceRef = (ref: WorkspaceResourceRef) => MothershipResource | null | undefined

/** Non-file chips carry their own id; resolving a file chip needs the caller's reads. */
const resolveWithoutFiles: ResolveResourceRef = (ref) => resolveWorkspaceResourceRef(ref, [])

function toResourceRef(data: WorkspaceResourceTagData): WorkspaceResourceRef {
  return { ...data, title: data.title ?? '' }
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
  resource: MothershipResource | null | undefined
): CopyableMarkdownResult {
  const label = workspaceResourceLabel(data)
  return {
    markdown: resource
      ? serializePortableChipLink(data.type, resource.id, resource.title || label, data.workspaceId)
      : label,
    hasUnresolvedFile: data.type === 'file' && !resource,
  }
}

function parseCopyableSegments(raw: string): ContentSegment[] {
  return parseSpecialTags(sanitizeChatDisplayContent(raw), false).segments
}

function serializeCopyableMarkdown(
  segments: ContentSegment[],
  resolve: (data: WorkspaceResourceTagData) => MothershipResource | null | undefined
): CopyableMarkdownResult {
  let hasUnresolvedFile = false

  const markdown = segments
    .reduce((markdown, segment, index) => {
      if (segment.type === 'text') return markdown + segment.content
      if (segment.type === 'workspace_resource') {
        const portable = portableWorkspaceResourceMarkdown(segment.data, resolve(segment.data))
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
  resolve: ResolveResourceRef = resolveWithoutFiles
): string {
  return serializeCopyableMarkdown(parseCopyableSegments(raw), (data) =>
    resolve(toResourceRef(data))
  ).markdown
}

/**
 * The message as portable Markdown, with chips resolved from what is cached. When a file chip
 * is not, the copy resolves its file chips fresh (`resolveFresh`) on demand, and keeps the
 * plain-text copy if that fails.
 */
export function prepareCopyableMarkdown(
  raw: string,
  resolveCached: ResolveResourceRef,
  resolveFresh: (ref: WorkspaceResourceRef) => Promise<MothershipResource | null>
): ClipboardContent {
  const segments = parseCopyableSegments(raw)
  const initial = serializeCopyableMarkdown(segments, (data) => resolveCached(toResourceRef(data)))
  if (!initial.hasUnresolvedFile) return initial.markdown

  return {
    fallback: initial.markdown,
    prepare: async () => {
      try {
        const fresh = new Map<WorkspaceResourceTagData, MothershipResource | null>()
        await Promise.all(
          segments.map(async (segment) => {
            if (segment.type !== 'workspace_resource' || segment.data.type !== 'file') return
            fresh.set(segment.data, await resolveFresh(toResourceRef(segment.data)))
          })
        )
        return serializeCopyableMarkdown(segments, (data) =>
          data.type === 'file' ? fresh.get(data) : resolveWithoutFiles(toResourceRef(data))
        ).markdown
      } catch {
        return initial.markdown
      }
    },
  }
}
