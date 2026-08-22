import type {
  ContentSegment,
  WorkspaceResourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

function startsInlineWord(value: string): boolean {
  return /^[A-Za-z0-9_(]/.test(value)
}

function endsInlineWord(value: string): boolean {
  return /[A-Za-z0-9_)]$/.test(value)
}

export function workspaceResourceLabel(data: WorkspaceResourceTagData): string {
  if (data.title) return data.title
  return data.type === 'file' ? (data.path ?? data.id ?? '') : (data.id ?? '')
}

function nextInlineSegmentLabel(segment?: ContentSegment): string {
  if (!segment) return ''
  if (segment.type === 'text') return segment.content
  if (segment.type === 'workspace_resource') return segment.data.title || segment.data.id || ''
  return ''
}

export function workspaceResourceReferenceMarkdown(data: WorkspaceResourceTagData): string {
  const ref = data.type === 'file' ? (data.path ?? data.id ?? '') : (data.id ?? '')
  return `[${workspaceResourceLabel(data)}](<#wsres-${data.type}-${ref}>)`
}

export function appendInlineReferenceMarkdown(
  currentMarkdown: string,
  referenceMarkdown: string,
  nextSegment?: ContentSegment
): string {
  let nextMarkdown = currentMarkdown
  if (currentMarkdown && endsInlineWord(currentMarkdown) && !/\s$/.test(currentMarkdown)) {
    nextMarkdown += ' '
  }

  nextMarkdown += referenceMarkdown

  const followingText = nextInlineSegmentLabel(nextSegment)
  if (
    followingText &&
    startsInlineWord(followingText) &&
    !/^\s/.test(followingText) &&
    !/\s$/.test(nextMarkdown)
  ) {
    nextMarkdown += ' '
  }

  return nextMarkdown
}
