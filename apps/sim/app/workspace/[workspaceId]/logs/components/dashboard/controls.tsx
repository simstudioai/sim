import type { ReactNode } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { soehne } from '@/app/fonts/soehne/soehne'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'

export function Controls({
  searchQuery,
  setSearchQuery,
  isRefetching,
  resetToNow,
  live,
  setLive,
  viewMode,
  setViewMode,
  searchComponent,
  showExport = true,
  onExport,
}: {
  searchQuery?: string
  setSearchQuery?: (v: string) => void
  isRefetching: boolean
  resetToNow: () => void
  live: boolean
  setLive: (v: (prev: boolean) => boolean) => void
  viewMode: string
  setViewMode: (mode: 'logs' | 'dashboard') => void
  searchComponent?: ReactNode
  showExport?: boolean
  onExport?: () => void
}) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start',
        soehne.className
      )}
    >
      {searchComponent ? (
        searchComponent
      ) : (
        <div className='relative w-full max-w-md'>
          <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-[18px] w-[18px] text-muted-foreground' />
          <Input
            type='text'
            placeholder='Search workflows...'
            value={searchQuery}
            onChange={(e) => setSearchQuery?.(e.target.value)}
            className='h-9 w-full border-[#E5E5E5] bg-[var(--white)] pr-10 pl-9 dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery?.('')}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 16 16'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
              >
                <path d='M12 4L4 12M4 4l8 8' />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className='ml-auto flex flex-shrink-0 items-center gap-3'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={resetToNow}
              className='h-9 w-9 p-0 hover:bg-secondary'
              disabled={isRefetching}
            >
              {isRefetching ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <RefreshCw className='h-5 w-5' />
              )}
              <span className='sr-only'>Refresh</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isRefetching ? 'Refreshing...' : 'Refresh'}</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={onExport}
              className='h-9 w-9 p-0 hover:bg-secondary'
              aria-label='Export CSV'
            >
              <svg
                xmlns='http://www.w3.org/2000/svg'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='h-5 w-5'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7 10 12 15 17 10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <span className='sr-only'>Export CSV</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Export CSV</Tooltip.Content>
        </Tooltip.Root>

        <div className='inline-flex h-9 items-center rounded-[11px] border bg-card p-1 shadow-sm'>
          <Button
            variant='ghost'
            onClick={() => setLive((v) => !v)}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              live
                ? 'bg-[var(--brand-primary-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)] hover:text-white hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={live}
          >
            Live
          </Button>
        </div>

        <div className='inline-flex h-9 items-center rounded-[11px] border bg-card p-1 shadow-sm'>
          <Button
            variant='ghost'
            onClick={() => setViewMode('logs')}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              (viewMode as string) !== 'dashboard'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={(viewMode as string) !== 'dashboard'}
          >
            Logs
          </Button>
          <Button
            variant='ghost'
            onClick={() => setViewMode('dashboard')}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              (viewMode as string) === 'dashboard'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={(viewMode as string) === 'dashboard'}
          >
            Dashboard
          </Button>
        </div>
      </div>

      <div className='sm:hidden'>
        <Timeline />
      </div>
    </div>
  )
}

export default Controls
