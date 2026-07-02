'use client'

import { useMemo } from 'react'
import { Chip } from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import Link from 'next/link'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { SimWordmark } from '@/app/(landing)/components/navbar/components'
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

  // The public viewer reuses the in-app FileViewer; the content source seam swaps
  // the auth-gated workspace serve URL for the token-scoped public endpoint, and a
  // synthetic record carries the metadata the renderers/query keys need. `key` and
  // `updatedAt` fold in the content version so the React Query caches (keyed on the
  // storage key + `updatedAt`) refetch when the shared file changes — even when its
  // size is unchanged.
  // Embedded images route through the token-scoped cascade endpoint, which serves them only when the
  // shared document actually references them and they live in its workspace.
  const source = useMemo(
    () => createPublicFileContentSource(token, contentUrl),
    [token, contentUrl]
  )
  const file = useMemo<WorkspaceFileRecord>(
    () => ({
      id: token,
      workspaceId: token,
      name,
      key: `${token}@${version}`,
      path: contentUrl,
      size,
      type,
      uploadedBy: '',
      folderId: null,
      uploadedAt: new Date(version),
      updatedAt: new Date(version),
    }),
    [token, name, type, size, version, contentUrl]
  )

  return (
    <div className='light flex min-h-screen flex-col bg-[var(--bg)]'>
      <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-[var(--border)] border-b bg-[var(--bg)] px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          {!brand.logoUrl && (
            <>
              <Link
                href='https://sim.ai'
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
            <span className='truncate font-medium text-[14px] text-[var(--text-body)]'>{name}</span>
            {provenance ? (
              <span className='truncate text-[12px] text-[var(--text-muted)]'>{provenance}</span>
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
        <FileViewer
          file={file}
          workspaceId={token}
          contentSource={source}
          canEdit={false}
          readOnly
        />
      </main>
    </div>
  )
}
