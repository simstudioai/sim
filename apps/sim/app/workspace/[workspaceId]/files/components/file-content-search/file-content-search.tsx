'use client'

import { useMemo, useRef } from 'react'
import { Chip, cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { FileText, Loader } from '@sim/emcn/icons'
import Link from 'next/link'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/workspace-files/search/constants'
import { useWorkspaceFileContentSearch } from '@/hooks/queries/workspace-file-search'

interface FileContentSearchProps {
  workspaceId: string
  query: string
  folderPath?: string
}

/** Bounded, independently loaded content matches for the Files browser. */
export function FileContentSearch({ workspaceId, query, folderPath }: FileContentSearchProps) {
  const search = useWorkspaceFileContentSearch(workspaceId, query, folderPath)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLUListElement>(null)
  const edges = useScrollEdges(scrollRef, {
    contentRef,
    enabled: search.isSuccess && search.data.results.length > 0,
  })
  const filesById = useMemo(
    () => new Map(search.data?.files.map((file) => [file.id, file])),
    [search.data?.files]
  )
  const length = [...query].length

  if (length < FILE_SEARCH_MIN_QUERY_LENGTH || length > FILE_SEARCH_MAX_QUERY_LENGTH) {
    return (
      <div
        role='status'
        className='flex flex-1 items-center justify-center p-6 text-[var(--text-secondary)] text-small'
      >
        {length < FILE_SEARCH_MIN_QUERY_LENGTH
          ? `Enter at least ${FILE_SEARCH_MIN_QUERY_LENGTH} characters to search inside files.`
          : `Search with ${FILE_SEARCH_MAX_QUERY_LENGTH} characters or fewer.`}
      </div>
    )
  }

  if (search.isPending) {
    return (
      <div
        role='status'
        className='flex flex-1 items-center justify-center gap-2 p-6 text-[var(--text-secondary)] text-small'
      >
        <Loader className='size-[14px]' animate />
        {isApiClientError(search.failureReason) && search.failureReason.status === 423
          ? 'Search is temporarily busy. Retrying…'
          : 'Searching file contents…'}
      </div>
    )
  }

  if (search.isError) {
    return (
      <div
        role='alert'
        className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-[var(--text-secondary)] text-small'
      >
        <p>{search.error.message}</p>
        <Chip onClick={() => void search.refetch()} disabled={search.isFetching}>
          Try again
        </Chip>
      </div>
    )
  }

  const { results, truncated, indexStatus } = search.data
  const excluded = indexStatus.skippedFiles + indexStatus.partialFiles

  return (
    <section
      aria-label='File content search results'
      aria-busy={search.isFetching}
      className='flex min-h-0 flex-1 flex-col'
    >
      <div className='flex shrink-0 items-center justify-between gap-4 border-[var(--border)] border-b px-4 py-2 text-[var(--text-secondary)] text-caption'>
        <p role='status'>
          {truncated
            ? `First ${results.length} matches`
            : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
          {search.isFetching ? ' · Updating…' : ''}
        </p>
        <Chip onClick={() => void search.refetch()} disabled={search.isFetching}>
          Refresh
        </Chip>
      </div>
      {(indexStatus.pendingFiles > 0 || indexStatus.failedFiles > 0 || excluded > 0) && (
        <div
          role='status'
          className='shrink-0 border-[var(--border)] border-b px-4 py-2 text-[var(--text-secondary)] text-caption'
        >
          {indexStatus.pendingFiles > 0 && (
            <p>
              {indexStatus.pendingFiles} {indexStatus.pendingFiles === 1 ? 'file is' : 'files are'}{' '}
              still being indexed. Results include only files indexed so far.
            </p>
          )}
          {indexStatus.failedFiles > 0 && (
            <p>
              {indexStatus.failedFiles}{' '}
              {indexStatus.failedFiles === 1 ? 'file could' : 'files could'} not be indexed.
            </p>
          )}
          {excluded > 0 && (
            <p>
              {excluded} {excluded === 1 ? 'file is' : 'files are'} not fully searchable, including
              unsupported formats and files over 25 MiB.
            </p>
          )}
        </div>
      )}
      {results.length === 0 ? (
        <p className='flex flex-1 items-center justify-center p-6 text-[var(--text-secondary)] text-small'>
          No matches in indexed files.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className={cn('min-h-0 flex-1 overflow-y-auto', scrollFadeClass)}
          {...scrollFadeAttributes(edges)}
        >
          <ul ref={contentRef}>
            {results.map((match) => {
              const file = filesById.get(match.fileId)
              if (!file) return null
              const href = `/workspace/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(file.id)}`
              return (
                <li
                  key={`${file.id}:${match.lineNumber}`}
                  className='border-[var(--border)] border-b'
                >
                  <Link
                    href={href}
                    prefetch={false}
                    className='block px-4 py-3 hover:bg-[var(--surface-3)] focus-visible:bg-[var(--surface-3)] focus-visible:outline-hidden'
                  >
                    <span className='flex items-center gap-2 text-[var(--text-primary)] text-small'>
                      <FileText className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                      <span className='min-w-0 break-words'>{file.name}</span>
                      <span className='shrink-0 text-[var(--text-secondary)] text-caption'>
                        Line {match.lineNumber}
                      </span>
                    </span>
                    <span className='mt-1 block whitespace-pre-wrap break-words font-mono text-[var(--text-secondary)] text-caption'>
                      {match.text}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {truncated && (
        <p className='shrink-0 border-[var(--border)] border-t px-4 py-2 text-[var(--text-secondary)] text-caption'>
          More matches exist. Narrow your search to see other results.
        </p>
      )}
    </section>
  )
}
