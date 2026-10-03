'use client'

import { type ReactElement, useEffect, useRef, useState } from 'react'
import { cn, OverflowText, Popover, PopoverAnchor, PopoverContent } from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { SourceIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip/source-icon'
import { useSourceNavigation } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { linkSiteName } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useLinkPreview } from '@/hooks/queries/link-preview'

interface SourcePreviewProps {
  source: SourceTagData
  children: ReactElement
}

/** One anchored preview shared by prose links and citations, with a hover bridge to its Open link. */
export function SourcePreview({ source, children }: SourcePreviewProps) {
  const anchor = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const restoringFocus = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)

  const cancelTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const changeOpen = (value: boolean) => {
    cancelTimer()
    setOpen(value)
  }
  const schedule = (value: boolean) => {
    cancelTimer()
    timer.current = setTimeout(
      () => {
        if (
          !value &&
          (anchor.current?.contains(document.activeElement) ||
            content.current?.contains(document.activeElement))
        )
          return
        setOpen(value)
      },
      value ? 300 : 150
    )
  }
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverAnchor
        asChild
        onPointerEnter={(event) => {
          anchor.current = event.currentTarget
          if (event.pointerType !== 'touch') schedule(true)
        }}
        onPointerLeave={() => schedule(false)}
        onFocus={(event) => {
          anchor.current = event.currentTarget
          if (!restoringFocus.current) changeOpen(true)
        }}
        onBlur={() => schedule(false)}
      >
        {children}
      </PopoverAnchor>
      {open && (
        <PopoverContent
          ref={content}
          appearance='tooltip'
          maxWidth='min(320px, calc(100vw - 2rem))'
          className={cn('w-[320px]', inter.className)}
          sideOffset={8}
          aria-label='Source preview'
          onFocusOutside={(event) => {
            const target = event.detail.originalEvent.target
            if (target instanceof Node && anchor.current?.contains(target)) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            changeOpen(false)
            restoringFocus.current = true
            anchor.current?.focus({ preventScroll: true })
            restoringFocus.current = false
          }}
          onPointerEnter={cancelTimer}
          onPointerLeave={() => schedule(false)}
          onFocusCapture={cancelTimer}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) schedule(false)
          }}
        >
          <SourcePreviewContent source={source} />
        </PopoverContent>
      )}
    </Popover>
  )
}

/** Mounting with the popover gates metadata and image work behind deliberate intent. */
function SourcePreviewContent({ source }: Pick<SourcePreviewProps, 'source'>) {
  const navigate = useSourceNavigation(source)
  const { data } = useLinkPreview(
    (!source.connectorType || source.connectorType === 'github') &&
      source.url.startsWith('https://')
      ? source.url
      : undefined
  )
  const preview = data?.preview
  const siteName = linkSiteName(source.url, source.siteName ?? preview?.siteName)
  const title = source.title?.trim() || preview?.title?.trim() || siteName
  const description =
    source.snippet?.trim() || (!source.connectorType && preview?.description?.trim())
  return (
    <div className='flex flex-col gap-3 p-1.5'>
      <div className='flex min-w-0 items-center justify-between gap-3 text-[var(--text-tertiary)] text-caption'>
        <span className='flex min-w-0 items-center gap-2'>
          <SourceIcon source={source} />
          <OverflowText label={siteName} tooltipEnabled={false} />
        </span>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          className='flex shrink-0 items-center gap-1 text-[var(--text-body)]'
          onClick={navigate}
          onAuxClick={navigate}
        >
          Open <ArrowUpRight aria-hidden className='size-[14px]' />
        </a>
      </div>
      {preview?.image && (
        <img
          src={preview.image}
          alt=''
          className='max-h-[168px] w-full rounded-lg object-contain'
        />
      )}
      <div className='flex flex-col gap-1.5'>
        <p className='break-words text-[var(--text-primary)] text-small leading-5'>{title}</p>
        {description && (
          <p className='line-clamp-3 text-[var(--text-secondary)] text-small leading-5'>
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
