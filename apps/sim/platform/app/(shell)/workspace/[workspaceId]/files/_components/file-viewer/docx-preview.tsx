'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/docx-preview.module.css'
import {
  PreviewError,
  resolvePreviewError,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import { PreviewToolbar } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-toolbar'
import { bindWheelZoom } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-wheel'
import { useDocPreviewBinary, type WorkspaceFileRecord } from '@/platform/lib/data/files'
import {
  assertOoxmlPreviewWithinLimits,
  sanitizeRenderedHyperlinks,
  stripEmbeddedFrames,
} from '@/platform/lib/data/files/office'

const ZOOM_MIN = 25
const ZOOM_MAX = 400
const ZOOM_STEP = 20
const ZOOM_WHEEL_SENSITIVITY = 0.005
const RESIZE_DEBOUNCE_MS = 150
const PAGE_SCROLL_MARGIN = 16
const PAGE_SELECTOR = 'section[class~="docx"]'
const WRAPPER_SELECTOR = '[class~="docx-wrapper"]'

/**
 * docx-preview draws each page at its natural print width, which overflows a narrow pane, so the
 * pages are scaled to the frame: 100% is fit to width, as for PDFs.
 */
function fitToFrame(host: HTMLElement, frame: HTMLElement, zoomPercent: number) {
  const wrapper = host.querySelector<HTMLElement>(WRAPPER_SELECTOR)
  const section = wrapper?.querySelector<HTMLElement>(PAGE_SELECTOR)
  if (!wrapper || !section) return
  host.style.minWidth = ''
  host.style.minHeight = ''
  host.style.width = ''
  wrapper.style.zoom = ''
  wrapper.style.width = ''
  const naturalPageWidth = section.offsetWidth
  if (!naturalPageWidth) return
  const wrapperStyle = getComputedStyle(wrapper)
  const naturalWidth =
    naturalPageWidth +
    Number.parseFloat(wrapperStyle.paddingLeft) +
    Number.parseFloat(wrapperStyle.paddingRight)
  const available = frame.clientWidth
  const scale = (available / naturalWidth) * (zoomPercent / 100)
  const scaledWidth = naturalWidth * scale
  wrapper.style.width = `${naturalWidth}px`
  wrapper.style.zoom = String(scale)
  host.style.width = `${Math.max(available, scaledWidth)}px`
  host.style.minWidth = `${scaledWidth}px`
  host.style.minHeight = `${wrapper.offsetHeight * scale}px`
}

interface DocxPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
}

/** A Word document drawn page by page, sanitized, with page steps and 25–400% zoom. */
export function DocxPreview({ file, workspaceId }: DocxPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(100)
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [renderVersion, setRenderVersion] = useState(0)

  const restyle = useCallback(() => {
    const host = hostRef.current
    const frame = frameRef.current
    if (!host || !frame) return
    const pages = Array.from(host.querySelectorAll<HTMLElement>(PAGE_SELECTOR))
    pages.forEach((page, index) => {
      page.dataset.page = String(index + 1)
      page.dataset.elevation = 'control'
    })
    setPageCount(pages.length)
    setCurrentPage((current) => (pages.length > 0 ? Math.min(current, pages.length) : 1))
    fitToFrame(host, frame, zoomRef.current)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(restyle, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(frame)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [restyle])

  const applyZoomAt = useCallback(
    (nextZoom: number, anchorX: number, anchorY: number) => {
      const frame = frameRef.current
      if (!frame) return
      const clamped = Math.round(Math.min(Math.max(nextZoom, ZOOM_MIN), ZOOM_MAX))
      const wrapper = hostRef.current?.querySelector<HTMLElement>(WRAPPER_SELECTOR)
      const frameRect = frame.getBoundingClientRect()
      const anchorClientX = frameRect.left + anchorX
      const anchorClientY = frameRect.top + anchorY
      const before = wrapper?.getBoundingClientRect()
      const ratioX = before && before.width > 0 ? (anchorClientX - before.left) / before.width : 0
      const ratioY = before && before.height > 0 ? (anchorClientY - before.top) / before.height : 0
      zoomRef.current = clamped
      setZoom(clamped)
      restyle()
      const after = wrapper?.getBoundingClientRect()
      if (!before || !after) return
      frame.scrollLeft += after.left + ratioX * after.width - anchorClientX
      frame.scrollTop += after.top + ratioY * after.height - anchorClientY
    },
    [restyle]
  )

  const zoomAroundCenter = (next: number) => {
    const frame = frameRef.current
    applyZoomAt(next, frame ? frame.clientWidth / 2 : 0, frame ? frame.clientHeight / 2 : 0)
  }

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    return bindWheelZoom(frame, (event) => {
      const rect = frame.getBoundingClientRect()
      applyZoomAt(
        zoomRef.current * (1 - event.deltaY * ZOOM_WHEEL_SENSITIVITY),
        event.clientX - rect.left,
        event.clientY - rect.top
      )
    })
  }, [applyZoomAt])

  useEffect(() => {
    const frame = frameRef.current
    const host = hostRef.current
    if (!frame || !host || pageCount === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (page) setCurrentPage(page)
        }
      },
      { root: frame, threshold: 0.5 }
    )
    for (const page of host.querySelectorAll<HTMLElement>(PAGE_SELECTOR)) observer.observe(page)
    return () => observer.disconnect()
  }, [pageCount, renderVersion])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !fileData) return
    let cancelled = false
    const render = async () => {
      try {
        await assertOoxmlPreviewWithinLimits(fileData)
        const { renderAsync } = await import('docx-preview')
        if (cancelled || !hostRef.current) return
        setRenderError(null)
        hostRef.current.innerHTML = ''
        await renderAsync(fileData, hostRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderAltChunks: false,
        })
        if (cancelled || !hostRef.current) return
        sanitizeRenderedHyperlinks(hostRef.current)
        stripEmbeddedFrames(hostRef.current)
        restyle()
        setRendered(true)
        setRenderVersion((version) => version + 1)
      } catch (error) {
        if (!cancelled) setRenderError(toError(error).message || 'Failed to render document')
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [fileData, restyle])

  const failure = resolvePreviewError(preview.error, renderError)
  if (failure) return <PreviewError label='document' error={failure} />

  const scrollToPage = (page: number) => {
    const frame = frameRef.current
    const target = hostRef.current?.querySelector<HTMLElement>(
      `${PAGE_SELECTOR}[data-page="${page}"]`
    )
    if (!frame || !target) return
    if (zoomRef.current !== 100) zoomAroundCenter(100)
    frame.scrollTo({
      top: target.offsetTop - frame.offsetTop - PAGE_SCROLL_MARGIN,
      behavior: 'smooth',
    })
  }

  return (
    <div className={styles.preview}>
      {rendered && (
        <PreviewToolbar
          navigation={{
            current: currentPage,
            total: pageCount,
            label: 'page',
            onPrevious: () => {
              const previous = Math.max(1, currentPage - 1)
              setCurrentPage(previous)
              scrollToPage(previous)
            },
            onNext: () => {
              const next = Math.min(pageCount, currentPage + 1)
              setCurrentPage(next)
              scrollToPage(next)
            },
          }}
          zoom={{
            label: `${zoom}%`,
            canZoomOut: zoom > ZOOM_MIN,
            canZoomIn: zoom < ZOOM_MAX,
            onReset: () => zoomAroundCenter(100),
            onZoomOut: () => zoomAroundCenter(zoom - ZOOM_STEP),
            onZoomIn: () => zoomAroundCenter(zoom + ZOOM_STEP),
          }}
        />
      )}
      <div ref={frameRef} className={styles.frame}>
        <div ref={hostRef} className={styles.host} data-rendered={rendered || undefined} />
      </div>
    </div>
  )
}
