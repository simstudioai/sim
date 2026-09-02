'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserDownloadInfo } from '@sim/desktop-bridge'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { CircleAlert, CircleCheck, Download, File, Loader } from '@sim/emcn/icons'
import {
  loadBrowserDownloads,
  onBrowserDownloadsState,
  showBrowserDownloadInFolder,
  showBrowserDownloadsMenu,
} from '@/lib/browser-agent/transport'

/** Aggregate byte progress for the toolbar rail; unknown-size downloads are ignored. */
export function aggregateDownloadPercent(downloads: BrowserDownloadInfo[]): number | null {
  const measurable = downloads.filter(
    (download) => download.state === 'progressing' && download.totalBytes > 0
  )
  const total = measurable.reduce((sum, download) => sum + download.totalBytes, 0)
  if (total <= 0) return null
  const received = measurable.reduce((sum, download) => sum + download.receivedBytes, 0)
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)))
}

/** Compact, stable byte labels for the right edge of a download row. */
export function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function downloadMeta(download: BrowserDownloadInfo): string {
  if (download.state === 'progressing' && download.totalBytes > 0) {
    return `${formatDownloadBytes(download.receivedBytes)} / ${formatDownloadBytes(download.totalBytes)}`
  }
  return formatDownloadBytes(Math.max(download.receivedBytes, download.totalBytes))
}

interface BrowserDownloadsProps {
  scopeId: string
  open: boolean
  requestOpen: (nativeFallback: () => void) => void
  onClose: () => void
}

/** Animated toolbar activity plus an emcn recent-downloads menu for one browser scope. */
export function BrowserDownloads({ scopeId, open, requestOpen, onClose }: BrowserDownloadsProps) {
  const [downloads, setDownloads] = useState<BrowserDownloadInfo[]>([])
  const [hasUnviewedCompletion, setHasUnviewedCompletion] = useState(false)
  const [completionAnimationVersion, setCompletionAnimationVersion] = useState(0)
  const downloadsRef = useRef<BrowserDownloadInfo[]>([])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const completionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    downloadsRef.current = []
    setDownloads([])
    setHasUnviewedCompletion(false)
    void loadBrowserDownloads(scopeId).then((state) => {
      if (!active) return
      downloadsRef.current = state.downloads
      setDownloads(state.downloads)
    })
    const unsubscribe = onBrowserDownloadsState((state) => {
      const prior = new Map(downloadsRef.current.map((download) => [download.id, download.state]))
      const justCompleted = state.downloads.some(
        (download) => download.state === 'completed' && prior.get(download.id) !== 'completed'
      )
      downloadsRef.current = state.downloads
      setDownloads(state.downloads)
      if (justCompleted) {
        setHasUnviewedCompletion(true)
        setCompletionAnimationVersion((version) => version + 1)
        if (completionTimerRef.current !== null) {
          window.clearTimeout(completionTimerRef.current)
        }
        completionTimerRef.current = window.setTimeout(() => {
          completionTimerRef.current = null
          setCompletionAnimationVersion(0)
        }, 1_200)
      }
    }, scopeId)
    return () => {
      active = false
      unsubscribe()
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
    }
  }, [scopeId])

  const activeDownloads = downloads.filter((download) => download.state === 'progressing')
  const aggregatePercent = useMemo(() => aggregateDownloadPercent(downloads), [downloads])

  if (downloads.length === 0) return null

  const hasActiveDownloads = activeDownloads.length > 0
  const label = hasActiveDownloads
    ? `Downloads, ${activeDownloads.length} in progress`
    : 'Downloads'

  return (
    <DropdownMenu
      open={open}
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
          return
        }
        requestOpen(() => {
          const rect = buttonRef.current?.getBoundingClientRect()
          if (rect) showBrowserDownloadsMenu({ x: rect.left, y: rect.bottom }, scopeId)
        })
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          type='button'
          variant='ghost-secondary'
          size='sm'
          aria-label={label}
          title={label}
          className={cn(
            'relative size-[30px] shrink-0 overflow-hidden p-0',
            hasUnviewedCompletion && 'text-[var(--brand-primary)]'
          )}
          onClick={() => setHasUnviewedCompletion(false)}
        >
          {hasActiveDownloads ? (
            <Loader animate className='size-[14px] text-[var(--brand-primary)]' />
          ) : completionAnimationVersion > 0 ? (
            <CircleCheck
              key={completionAnimationVersion}
              className='zoom-in-50 size-[14px] animate-in text-[var(--badge-success-text)] duration-150 motion-reduce:animate-none'
            />
          ) : (
            <Download className='size-[14px]' />
          )}
          {hasActiveDownloads && aggregatePercent !== null && (
            <span
              aria-hidden
              className='absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-[var(--surface-6)]'
            >
              <span
                className='block h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-150'
                style={{ width: `${aggregatePercent}%` }}
              />
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={5} className='w-[320px]'>
        <DropdownMenuLabel>Downloads</DropdownMenuLabel>
        {downloads.map((download) => {
          const completed = download.state === 'completed'
          return (
            <DropdownMenuItem
              key={download.id}
              disabled={!completed}
              className='h-auto min-h-[42px] py-2'
              onSelect={() => {
                if (completed) void showBrowserDownloadInFolder(download.id, scopeId)
              }}
            >
              {download.state === 'progressing' ? (
                <Loader animate />
              ) : download.state === 'completed' ? (
                <File />
              ) : (
                <CircleAlert className='text-[var(--text-error)]' />
              )}
              <span className='min-w-0 flex-1 truncate'>{download.filename}</span>
              <span className='ml-auto shrink-0 text-[var(--text-muted)] text-xs tabular-nums'>
                {downloadMeta(download)}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
