'use client'

import { useEffect, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import {
  ArrowUpDown,
  ChevronRight,
  Download,
  Files as FilesIcon,
  Search,
  Send,
} from '@sim/emcn/icons'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { LibraryFileDetail } from '@/app/(landing)/files/components/files-library-preview/components/library-file-detail'
import { LibraryFileList } from '@/app/(landing)/files/components/files-library-preview/components/library-file-list'
import { FILES } from '@/app/(landing)/files/components/files-library-preview/data'

/** Native Files columns and document navigation, with local search and sorting. */
export function FilesLibraryPreview() {
  const searchRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const previousSelectionRef = useRef<string | null>(null)
  const [query, setQuery] = useState('')
  const [ascending, setAscending] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedFile = FILES.find((file) => file.id === selectedId)
  const visibleFiles = FILES.filter((file) =>
    file.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  if (ascending) visibleFiles.sort((a, b) => a.name.localeCompare(b.name))

  useEffect(() => {
    if (selectedId) backRef.current?.focus()
    else if (previousSelectionRef.current) searchRef.current?.focus()
    previousSelectionRef.current = selectedId
  }, [selectedId])

  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 absolute top-20 left-1/2 h-[440px] w-[780px] max-w-[calc(100%_-_48px)] max-sm:top-8 max-sm:h-[410px]'>
        <div className='flex h-full flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs'>
          <MenuPreviewHeader
            icon={FilesIcon}
            title={
              selectedFile ? (
                <>
                  <button
                    ref={backRef}
                    type='button'
                    onClick={() => setSelectedId(null)}
                    className='rounded-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-2'
                  >
                    Files
                  </button>
                  <ChevronRight className='size-3 shrink-0 text-[var(--text-secondary)]' />
                  <span className='truncate'>{selectedFile.name}</span>
                </>
              ) : (
                'Files'
              )
            }
            actions={
              selectedFile && (
                <span aria-hidden='true' inert className='flex'>
                  <Chip leftIcon={Download}>Download</Chip>
                  <Chip leftIcon={Send}>Share</Chip>
                </span>
              )
            }
          />
          {selectedFile ? (
            <LibraryFileDetail file={selectedFile} />
          ) : (
            <>
              <MenuPreviewToolbar>
                <label className='mr-auto ml-2 flex min-w-0 flex-1 items-center gap-2 text-[var(--text-secondary)]'>
                  <Search aria-hidden='true' className='size-[14px] shrink-0' />
                  <input
                    ref={searchRef}
                    type='search'
                    aria-label='Search demo files'
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search files...'
                    className='h-8 w-full min-w-0 rounded-sm bg-transparent text-[var(--text-body)] text-small outline-none placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--border)] max-sm:text-[16px]'
                  />
                </label>
                <Chip
                  leftIcon={ArrowUpDown}
                  active={ascending}
                  aria-pressed={ascending}
                  aria-label='Sort files by name'
                  onClick={() => setAscending((value) => !value)}
                >
                  Sort
                </Chip>
              </MenuPreviewToolbar>
              <LibraryFileList files={visibleFiles} onSelect={setSelectedId} />
            </>
          )}
        </div>
        <EdgeFade ground='canvas' edges={['bottom']} depth='stage' />
      </div>
      <EdgeFade ground='canvas' edges={['top', 'left', 'right']} depth='preview' />
    </div>
  )
}
