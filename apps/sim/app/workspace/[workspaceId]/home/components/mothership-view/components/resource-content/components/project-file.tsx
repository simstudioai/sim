'use client'

import type { MutableRefObject } from 'react'
import { Skeleton, TabStripAction, Tooltip, toast } from '@sim/emcn'
import { Download, FileX, SquareArrowUpRight } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { type FileDownloadSource, triggerProjectFileDownload } from '@/lib/uploads/client/download'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RESOURCE_TAB_ICON_CLASS } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { useProjectFile } from '@/hooks/queries/project-files'

interface ProjectFileProps {
  projectId: string
  fileId: string
  downloadSourceRef?: MutableRefObject<FileDownloadSource | null>
  previewMode?: PreviewMode
  streamingContent?: string
  isAgentEditing?: boolean
  streamIsIncremental?: boolean
  streamOperation?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

export function EmbeddedProjectFile({ projectId, fileId, ...viewerProps }: ProjectFileProps) {
  const { data, isPending, error } = useProjectFile(projectId, fileId)
  if (isPending) {
    return (
      <div className='flex h-full flex-col gap-2 p-6'>
        <Skeleton className='h-[16px] w-[60%]' />
        <Skeleton className='h-[16px] w-[80%]' />
      </div>
    )
  }
  if (!data) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <FileX className='size-[32px] text-[var(--text-icon)]' />
        <p className='text-[var(--text-body)] text-small'>
          {getErrorMessage(error, 'This Project file is unavailable')}
        </p>
      </div>
    )
  }
  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <FileViewer
        {...viewerProps}
        key={data.file.id}
        file={data.file}
        owner={data.file.owner}
        canEdit={data.capabilities.canWrite}
        collaborative
        enableFind
      />
    </div>
  )
}

interface ProjectFileActionsProps {
  projectId: string
  fileId: string
  downloadSourceRef?: MutableRefObject<FileDownloadSource | null>
}

export function ProjectFileActions({
  projectId,
  fileId,
  downloadSourceRef,
}: ProjectFileActionsProps) {
  const router = useRouter()
  const { data } = useProjectFile(projectId, fileId)

  async function download() {
    if (!data) return
    try {
      await triggerProjectFileDownload(data.file, downloadSourceRef?.current)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to download this file'))
    }
  }

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <TabStripAction
            variant='subtle'
            disabled={!data}
            onClick={() =>
              router.push(
                `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
              )
            }
            aria-label='Open in files'
          >
            <SquareArrowUpRight className={RESOURCE_TAB_ICON_CLASS} />
          </TabStripAction>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>Open in files</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <TabStripAction
            variant='subtle'
            onClick={() => void download()}
            disabled={!data}
            aria-label='Download file'
          >
            <Download className={RESOURCE_TAB_ICON_CLASS} />
          </TabStripAction>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>Download</Tooltip.Content>
      </Tooltip.Root>
    </>
  )
}
