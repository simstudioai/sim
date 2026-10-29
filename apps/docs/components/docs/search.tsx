'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Search, X } from '@sim/emcn/icons'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { cn } from '@/components/docs/classnames'
import { useDocsSearch } from '@/hooks/queries/search'

const SearchContext = createContext<((trigger?: HTMLElement) => void) | null>(null)

interface DocsSearchProviderProps {
  children: ReactNode
}
interface DocsSearchTriggerProps {
  compact?: boolean
}

/** One dialog and shortcut serve every responsive trigger in the docs shell. */
export function DocsSearchProvider({ children }: DocsSearchProviderProps) {
  const [client] = useState(() => new QueryClient())
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const show = (element?: HTMLElement) => {
    trigger.current =
      element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setOpen(true)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        trigger.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <SearchContext value={show}>
      {children}
      <QueryClientProvider client={client}>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className='docs-root fixed inset-0 z-50 bg-[var(--docs-overlay)] backdrop-blur-sm' />
            <Dialog.Content
              className='docs-root -translate-x-1/2 fixed top-[10vh] left-1/2 z-50 flex max-h-[80dvh] w-[calc(100%-32px)] max-w-[640px] flex-col overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-canvas)] text-[var(--docs-text)] shadow-2xl outline-none'
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                trigger.current?.focus()
              }}
            >
              <Dialog.Title className='sr-only'>Search documentation</Dialog.Title>
              <Dialog.Description className='sr-only'>
                Search guides, API references, CLI commands and MCP documentation.
              </Dialog.Description>
              {open && <SearchContents close={() => setOpen(false)} />}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </QueryClientProvider>
    </SearchContext>
  )
}

export function DocsSearchTrigger({ compact = false }: DocsSearchTriggerProps) {
  const show = useContext(SearchContext)
  return (
    <button
      type='button'
      aria-label='Search documentation'
      aria-haspopup='dialog'
      onClick={(event) => show?.(event.currentTarget)}
      className={cn(
        'flex items-center gap-1.5 rounded-lg text-[var(--docs-muted)] text-docs-nav transition-colors hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 active:bg-[var(--docs-pressed)]',
        compact
          ? 'size-11 justify-center'
          : 'h-[30px] w-full border border-[var(--docs-border)] bg-[var(--docs-reading)] px-[7px]'
      )}
    >
      <Search className='size-4 shrink-0' aria-hidden />
      {!compact && (
        <>
          <span>Search docs…</span>
          <kbd className='ml-auto w-7 shrink-0 text-center font-mono text-docs-keyboard'>⌘K</kbd>
        </>
      )}
    </button>
  )
}

interface SearchContentsProps {
  close: () => void
}

function SearchContents({ close }: SearchContentsProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180)
    return () => clearTimeout(timer)
  }, [query])
  const search = useDocsSearch(debounced)
  const results = query.trim() === debounced ? (search.data ?? []) : []
  const loading = query.trim() !== debounced || (Boolean(debounced) && search.isPending)
  const selectedIndex = Math.min(selected, Math.max(0, results.length - 1))
  useEffect(() => {
    document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [listId, selectedIndex])
  const navigate = (index: number) => {
    const result = results[index]
    if (!result) return
    const target = new URL(result.url, window.location.origin)
    close()
    router.push(`${target.pathname}${target.hash}`)
  }

  return (
    <>
      <div className='flex items-center gap-3 border-[var(--docs-border)] border-b px-4 py-3'>
        <Search className='size-4 shrink-0 text-[var(--docs-muted)]' aria-hidden />
        <input
          ref={inputRef}
          type='search'
          role='combobox'
          aria-label='Search documentation'
          aria-controls={listId}
          aria-expanded={results.length > 0}
          aria-activedescendant={results.length ? `${listId}-${selectedIndex}` : undefined}
          aria-autocomplete='list'
          autoComplete='off'
          maxLength={256}
          placeholder='Search documentation…'
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length)
                setSelected(
                  (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
                    results.length
                )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              navigate(selectedIndex)
            }
          }}
          className='min-w-0 flex-1 bg-transparent text-docs-body outline-none placeholder:text-[var(--docs-muted)]'
        />
        <Dialog.Close
          className='before:-inset-1.5 relative flex size-8 shrink-0 items-center justify-center rounded-md before:absolute hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)]'
          aria-label='Close search'
        >
          <X className='size-4' aria-hidden />
        </Dialog.Close>
      </div>
      <div className='min-h-36 overflow-y-auto p-2'>
        <div
          role='status'
          aria-live='polite'
          className={cn(
            'p-6 text-center text-[var(--docs-muted)] text-docs-nav',
            results.length > 0 && !search.isError && 'sr-only'
          )}
        >
          {!query.trim()
            ? 'Search guides, API reference, CLI, and MCP.'
            : loading
              ? 'Searching…'
              : search.isError
                ? 'Search is unavailable. Try again.'
                : results.length
                  ? `${results.length} results`
                  : `No results for “${query.trim()}”.`}
          {search.isError && !loading && (
            <button
              type='button'
              className='mt-3 block w-full text-[var(--docs-link)]'
              onClick={() => {
                void search.refetch()
              }}
            >
              Try again
            </button>
          )}
        </div>
        <div id={listId} role='listbox' aria-label='Search results'>
          {results.map((result, index) => (
            <div
              key={result.id}
              id={`${listId}-${index}`}
              role='option'
              aria-selected={selectedIndex === index}
              onMouseMove={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => navigate(index)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3',
                selectedIndex === index
                  ? 'bg-[var(--docs-selected)]'
                  : 'hover:bg-[var(--docs-hover)]'
              )}
            >
              <div className='min-w-0 flex-1'>
                <div className='truncate text-[var(--docs-heading)] text-docs-nav'>
                  {result.content}
                </div>
                <div className='mt-1 truncate text-[var(--docs-muted)] text-docs-control'>
                  {result.breadcrumbs.join(' / ')}
                </div>
              </div>
              <ArrowRight className='size-4 shrink-0 text-[var(--docs-muted)]' aria-hidden />
            </div>
          ))}
        </div>
      </div>
      <div className='flex gap-4 border-[var(--docs-border)] border-t px-4 py-3 text-[var(--docs-muted)] text-docs-control'>
        <span>↑ ↓ Navigate</span>
        <span>Enter Open</span>
        <span className='ml-auto'>Esc Close</span>
      </div>
    </>
  )
}
