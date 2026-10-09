'use client'

import { useRef } from 'react'
import {
  Chip,
  cn,
  OverflowText,
  SimWordmark,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ChevronRight, Download, File, Folder } from '@sim/emcn/icons'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { SITE_URL } from '@/lib/core/utils/urls'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { PublicFilePreview } from '@/app/f/[token]/public-file-view'
import { publicFolderParsers, publicFolderUrlKeys } from '@/app/f/[token]/search-params'
import { buildProvenance } from '@/app/f/[token]/utils'
import { useBrandConfig } from '@/ee/whitelabeling'
import { usePublicFolder, usePublicSharedFile } from '@/hooks/queries/public-shares'

interface PublicFolderViewProps {
  token: string
  name: string
  workspaceName: string | null
  ownerName: string | null
}

/** A public capability browses the live folder tree, with all file reads bound to its token. */
export function PublicFolderView({ token, name, workspaceName, ownerName }: PublicFolderViewProps) {
  const [{ folderId, fileId, cursor }, setLocation] = useQueryStates(
    publicFolderParsers,
    publicFolderUrlKeys
  )
  const file = usePublicSharedFile(token, fileId)
  const currentFolderId = fileId ? (file.data?.folderId ?? folderId) : folderId
  const listing = usePublicFolder(
    token,
    currentFolderId,
    fileId ? null : cursor,
    !fileId || file.isSuccess
  )
  const page = listing.data
  const brand = useBrandConfig()
  const provenance = buildProvenance(workspaceName, ownerName)
  const error = fileId ? (file.error ?? listing.error) : listing.error
  const loading = fileId ? file.isPending || listing.isPending : listing.isPending
  const entries = page?.entries ?? []
  const breadcrumbs = page?.breadcrumbs ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef, { enabled: !fileId && listing.isSuccess })

  return (
    <div className='light desktop-title-bar-page flex h-screen flex-col overflow-hidden bg-[var(--bg)]'>
      <DesktopTitleBarLane />
      <header className='flex shrink-0 items-center justify-between gap-4 border-[var(--border)] border-b bg-[var(--bg)] px-4 py-3'>
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
            <nav
              aria-label='Shared folder path'
              className='flex min-w-0 items-center gap-1 overflow-x-auto text-sm'
            >
              {breadcrumbs.length ? (
                breadcrumbs.map((crumb, index) => (
                  <div key={crumb.id} className='flex min-w-0 shrink-0 items-center gap-1'>
                    {index > 0 && <ChevronRight className='size-[14px] text-[var(--text-muted)]' />}
                    <Chip
                      className='max-w-[240px]'
                      onClick={() =>
                        setLocation({
                          folderId: index === 0 ? null : crumb.id,
                          fileId: null,
                          cursor: null,
                        })
                      }
                    >
                      {crumb.name}
                    </Chip>
                  </div>
                ))
              ) : (
                <OverflowText label={name} />
              )}
              {file.data && (
                <>
                  <ChevronRight className='size-[14px] shrink-0 text-[var(--text-muted)]' />
                  <OverflowText label={file.data.name} className='text-[var(--text-body)]' />
                </>
              )}
            </nav>
            {provenance && (
              <OverflowText label={provenance} className='text-[var(--text-muted)] text-caption' />
            )}
          </div>
        </div>
        {fileId && file.data && !error && (
          <Chip
            variant='primary'
            leftIcon={Download}
            onClick={() => {
              const anchor = document.createElement('a')
              anchor.href = `/api/files/public/${token}/content?fileId=${encodeURIComponent(fileId)}`
              anchor.download = file.data.name
              anchor.click()
            }}
          >
            Download
          </Chip>
        )}
      </header>
      <main className='flex min-h-0 flex-1 flex-col'>
        {error ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-3'>
            <p className='text-[var(--text-muted)] text-sm'>This shared content is unavailable.</p>
            <Chip
              onClick={() => {
                if (fileId && file.isError) void file.refetch()
                else void listing.refetch()
              }}
            >
              Try again
            </Chip>
          </div>
        ) : loading ? (
          <div
            className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-sm'
            role='status'
          >
            Loading…
          </div>
        ) : fileId && file.data ? (
          <PublicFilePreview
            token={token}
            fileId={fileId}
            name={file.data.name}
            type={file.data.type}
            size={file.data.size}
            version={file.data.version ?? 0}
          />
        ) : (
          <div
            ref={scrollRef}
            className={cn('min-h-0 flex-1 overflow-auto', scrollFadeClass)}
            {...scrollFadeAttributes(edges)}
          >
            <table className='w-full table-fixed text-left text-sm'>
              <thead className='sticky top-0 bg-[var(--bg)] text-[var(--text-muted)]'>
                <tr className='border-[var(--border)] border-b'>
                  <th className='px-6 py-3 font-normal'>Name</th>
                  <th className='w-[120px] px-4 py-3 font-normal'>Size</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={`${entry.kind}:${entry.id}`}
                    className='border-[var(--border)] border-b hover:bg-[var(--surface-active)]'
                  >
                    <td className='px-6 py-3'>
                      <Chip
                        fullWidth
                        leftIcon={entry.kind === 'folder' ? Folder : File}
                        onClick={() =>
                          setLocation(
                            entry.kind === 'folder'
                              ? { folderId: entry.id, fileId: null, cursor: null }
                              : {
                                  folderId: page?.folder.id ?? folderId,
                                  fileId: entry.id,
                                  cursor: null,
                                }
                          )
                        }
                      >
                        {entry.name}
                      </Chip>
                    </td>
                    <td className='px-4 py-3 text-[var(--text-muted)]'>
                      {entry.kind === 'file' ? formatFileSize(entry.size) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && (
              <p className='p-8 text-center text-[var(--text-muted)] text-sm'>
                This folder is empty.
              </p>
            )}
            {(page?.previousCursor || page?.nextCursor) && (
              <nav aria-label='Folder pages' className='flex justify-center gap-2 p-4'>
                <Chip
                  disabled={!page.previousCursor}
                  onClick={() => setLocation({ cursor: page.previousCursor })}
                >
                  Previous
                </Chip>
                <Chip
                  disabled={!page.nextCursor}
                  onClick={() => setLocation({ cursor: page.nextCursor })}
                >
                  Next
                </Chip>
              </nav>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
