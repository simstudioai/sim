'use client'

import { useMemo } from 'react'
import { Chip, OverflowText, SimWordmark } from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import Link from 'next/link'
import { SITE_URL } from '@/lib/core/utils/urls'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { buildProvenance } from '@/app/f/[token]/utils'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useBrandConfig } from '@/ee/whitelabeling'
import { createPublicFileContentSource } from '@/hooks/use-file-content-source'

interface PublicFileViewProps {
  token: string
  name: string
  type: string
  size: number
  /** Content version (the file's `updatedAt`, epoch ms) — busts the viewer's caches when the file changes. */
  version: number
  workspaceName: string | null
  ownerName: string | null
}

export function PublicFileView({
  token,
  name,
  type,
  size,
  version,
  workspaceName,
  ownerName,
}: PublicFileViewProps) {
  const contentUrl = `/api/files/public/${token}/content`
  const brand = useBrandConfig()
  const provenance = buildProvenance(workspaceName, ownerName)

  return (
    <div className='light desktop-title-bar-page flex h-screen flex-col overflow-hidden bg-[var(--bg)]'>
      <DesktopTitleBarLane />
      <header className='z-10 flex shrink-0 items-center justify-between gap-4 border-[var(--border)] border-b bg-[var(--bg)] px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          {!brand.logoUrl && (
            <>
              <Link
                href={SITE_URL}
                target='_blank'
                rel='noopener noreferrer'
                aria-label='Sim home'
                className='flex shrink-0 items-center'
              >
                <SimWordmark />
              </Link>
              <div className='h-5 w-px shrink-0 bg-[var(--border)]' />
            </>
          )}
          <div className='flex min-w-0 flex-col'>
            <OverflowText label={name} className='text-[var(--text-body)] text-sm' />
            {provenance ? (
              <span className='truncate text-[var(--text-muted)] text-caption'>{provenance}</span>
            ) : null}
          </div>
        </div>
        <Chip
          variant='primary'
          leftIcon={Download}
          onClick={() => {
            const anchor = document.createElement('a')
            anchor.href = contentUrl
            anchor.download = name
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
          }}
        >
          Download
        </Chip>
      </header>

      <main className='flex min-h-0 flex-1 flex-col'>
        <PublicFilePreview token={token} name={name} type={type} size={size} version={version} />
      </main>
    </div>
  )
}

interface PublicFilePreviewProps {
  token: string
  fileId?: string
  name: string
  type: string
  size: number
  version: number
}

/** The same read-only renderer serves direct file shares and children of a folder capability. */
export function PublicFilePreview({
  token,
  fileId,
  name,
  type,
  size,
  version,
}: PublicFilePreviewProps) {
  const contentUrl = `/api/files/public/${token}/content${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`
  const source = useMemo(
    () => createPublicFileContentSource(token, contentUrl, fileId),
    [token, contentUrl, fileId]
  )
  const file = useMemo<WorkspaceFileRecord>(
    () => ({
      id: fileId ?? token,
      workspaceId: token,
      name,
      key: `${token}:${fileId ?? ''}@${version}`,
      path: contentUrl,
      size,
      type,
      uploadedBy: '',
      folderId: null,
      uploadedAt: new Date(version),
      updatedAt: new Date(version),
    }),
    [fileId, token, name, type, size, version, contentUrl]
  )
  return (
    <FileViewer
      file={file}
      workspaceId={token}
      contentSource={source}
      canEdit={false}
      readOnly
      enableFind
    />
  )
}
