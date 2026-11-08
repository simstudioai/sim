'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { PreviewToolbar } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/file-preview/preview-toolbar'
import { bindWheelZoom } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/file-preview/preview-wheel'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/pptx-preview.module.css'
import {
  PreviewError,
  resolvePreviewError,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import { useDocPreviewBinary, type WorkspaceFileRecord } from '@/platform/lib/data/files'
import { openSimPptxViewer, type SimPptxViewerHandle } from '@/platform/lib/data/files/pptx'

const ZOOM_MIN = 25
const ZOOM_MAX = 400
const ZOOM_STEP = 20
const ZOOM_WHEEL_SENSITIVITY = 0.005

interface PptxPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
}

/**
 * A presentation drawn by the sandboxed slide renderer: slide steps and 25–400% zoom. A new
 * version renders off screen and replaces the one shown only once it is ready.
 */
export function PptxPreview({ file, workspaceId }: PptxPreviewProps) {
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data
  const requestId = `${file.id}:${preview.dataUpdatedAt}:${fileData?.byteLength ?? 0}`
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<SimPptxViewerHandle | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sequenceRef = useRef(0)
  const zoomRef = useRef(100)
  const [zoom, setZoom] = useState(100)
  const [slideCount, setSlideCount] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(1)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !fileData) return
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    const next = document.createElement('div')
    next.style.width = '100%'
    next.style.visibility = 'hidden'
    stage.appendChild(next)
    setRenderError(null)
    const render = async () => {
      try {
        const handle = await openSimPptxViewer({
          buffer: fileData,
          container: next,
          scrollContainer: frameRef.current ?? undefined,
          signal: controller.signal,
          onSlideChange: (index) => setCurrentSlide(index + 1),
          onSlideError: () => {},
        })
        if (controller.signal.aborted || sequence !== sequenceRef.current) {
          handle.destroy()
          next.remove()
          return
        }
        const previousHandle = handleRef.current
        const previousContainer = containerRef.current
        handleRef.current = handle
        containerRef.current = next
        setSlideCount(handle.viewer.slideCount)
        setCurrentSlide(handle.viewer.currentSlideIndex + 1)
        if (zoomRef.current !== 100) await handle.viewer.setZoom(zoomRef.current)
        next.style.visibility = 'visible'
        previousHandle?.destroy()
        previousContainer?.remove()
      } catch (error) {
        next.remove()
        if (!controller.signal.aborted)
          setRenderError(toError(error).message || 'Failed to render presentation')
      }
    }
    void render()
    return () => {
      controller.abort()
      if (containerRef.current !== next) next.remove()
    }
  }, [fileData, requestId])

  useEffect(
    () => () => {
      sequenceRef.current += 1
      handleRef.current?.destroy()
      containerRef.current?.remove()
    },
    []
  )

  const applyZoomAt = useCallback(async (nextZoom: number, anchorX: number, anchorY: number) => {
    const frame = frameRef.current
    if (!frame) return
    const clamped = Math.round(Math.min(Math.max(nextZoom, ZOOM_MIN), ZOOM_MAX))
    const ratio = clamped / zoomRef.current
    const style = getComputedStyle(frame)
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const scrollLeft = frame.scrollLeft
    const scrollTop = frame.scrollTop
    zoomRef.current = clamped
    setZoom(clamped)
    await handleRef.current?.viewer.setZoom(clamped)
    frame.scrollLeft = (scrollLeft + anchorX - paddingLeft) * ratio + paddingLeft - anchorX
    frame.scrollTop = (scrollTop + anchorY - paddingTop) * ratio + paddingTop - anchorY
  }, [])

  const zoomAroundCenter = useCallback(
    (next: number) => {
      const frame = frameRef.current
      return applyZoomAt(
        next,
        frame ? frame.clientWidth / 2 : 0,
        frame ? frame.clientHeight / 2 : 0
      )
    },
    [applyZoomAt]
  )

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    return bindWheelZoom(frame, (event) => {
      const rect = frame.getBoundingClientRect()
      void applyZoomAt(
        zoomRef.current * (1 - event.deltaY * ZOOM_WHEEL_SENSITIVITY),
        event.clientX - rect.left,
        event.clientY - rect.top
      )
    })
  }, [applyZoomAt])

  const goToSlide = async (slide: number) => {
    const handle = handleRef.current
    if (!handle || slideCount <= 0) return
    const clamped = Math.min(Math.max(slide, 1), slideCount)
    if (zoomRef.current !== 100) await zoomAroundCenter(100)
    setCurrentSlide(clamped)
    await handle.viewer.goToSlide(clamped - 1)
  }

  const failure = resolvePreviewError(preview.error, renderError)
  if (failure) return <PreviewError label='presentation' error={failure} />

  return (
    <div className={styles.preview}>
      {slideCount > 0 && (
        <PreviewToolbar
          navigation={{
            current: currentSlide,
            total: slideCount,
            label: 'slide',
            onPrevious: () => void goToSlide(currentSlide - 1),
            onNext: () => void goToSlide(currentSlide + 1),
          }}
          zoom={{
            label: `${zoom}%`,
            canZoomOut: zoom > ZOOM_MIN,
            canZoomIn: zoom < ZOOM_MAX,
            onReset: () => void zoomAroundCenter(100),
            onZoomOut: () => void zoomAroundCenter(zoom - ZOOM_STEP),
            onZoomIn: () => void zoomAroundCenter(zoom + ZOOM_STEP),
          }}
        />
      )}
      <div ref={frameRef} className={styles.frame}>
        <div ref={stageRef} className={styles.stage} />
      </div>
    </div>
  )
}
