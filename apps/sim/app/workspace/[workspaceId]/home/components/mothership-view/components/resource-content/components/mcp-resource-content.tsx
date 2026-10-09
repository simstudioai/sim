'use client'

import { ChipLink } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { mcpPresentationAssetUrl } from '@/lib/mcp/presentation'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveFileCategory } from '@/lib/uploads/utils/file-category'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer/file-viewer'
import { useMcpPresentationMetadata } from '@/hooks/queries/mcp-presentations'
import type { FileContentSource } from '@/hooks/use-file-content-source'

interface McpResourceContentProps {
  resource: MothershipResource
  chatId?: string | null
}

interface McpArtifactPreviewProps {
  chatId: string
  presentationId: string
  index: number
}

const SNAPSHOT_DATE = new Date(0)

function McpArtifactPreview({ chatId, presentationId, index }: McpArtifactPreviewProps) {
  const { data, error, isPending } = useMcpPresentationMetadata(chatId, presentationId)
  if (isPending) return <p className='p-4 text-[var(--text-muted)] text-small'>Opening result…</p>
  if (error)
    return (
      <p className='p-4 text-[var(--text-error)] text-small' role='alert'>
        {getErrorMessage(error, 'Unable to open result')}
      </p>
    )
  const workspaceId = data.workspaceId
  const item = data.receipt.items.find((candidate) => candidate.index === index)
  if (!item) return <p className='p-4 text-[var(--text-muted)] text-small'>Result unavailable</p>
  const url = mcpPresentationAssetUrl(chatId, presentationId, index)
  const plainText =
    item.mimeType.startsWith('text/') ||
    ['application/json', 'application/xml'].includes(item.mimeType)
  const category = resolveFileCategory(item.mimeType, '')
  const previewable =
    plainText ||
    (item.kind === 'image' && category === 'image-previewable') ||
    (item.kind === 'audio' && category === 'audio-previewable') ||
    [
      'iframe-previewable',
      'video-previewable',
      'docx-previewable',
      'pptx-previewable',
      'xlsx-previewable',
    ].includes(category)
  if (!previewable)
    return (
      <div className='p-4'>
        <ChipLink
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          prefetch={false}
          variant='border'
        >
          Download {item.title}
        </ChipLink>
      </div>
    )
  const contentSource: FileContentSource = {
    buildUrl: () => url,
    resolveImageSrc: () => undefined,
    hasCommittedContent: true,
  }
  const file: WorkspaceFileRecord = {
    id: item.identity,
    workspaceId,
    name: plainText ? `${item.title}.txt` : item.title,
    key: `${chatId}/${presentationId}/${index}`,
    path: url,
    size: 0,
    type: plainText ? 'text/plain' : item.mimeType,
    uploadedBy: '',
    uploadedAt: SNAPSHOT_DATE,
    updatedAt: SNAPSHOT_DATE,
  }
  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <FileViewer
        key={file.key}
        file={file}
        workspaceId={workspaceId}
        contentSource={contentSource}
        canEdit={false}
        readOnly
      />
    </div>
  )
}

export function McpResourceContent({ resource, chatId }: McpResourceContentProps) {
  if (!chatId || !resource.mcp) return null
  return (
    <McpArtifactPreview
      chatId={chatId}
      presentationId={resource.mcp.presentationId}
      index={resource.mcp.index}
    />
  )
}
