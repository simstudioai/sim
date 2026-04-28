'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Skeleton } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import {
  PreviewError,
  resolvePreviewError,
  shouldSuppressStreamingDocumentError,
} from './preview-shared'

const logger = createLogger('PptxPreview')

const PPTX_SLIDE_SKELETON = (
  <div className='flex flex-1 flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[720px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className='flex h-full flex-col justify-between'>
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-[18px] w-[50%]' />
            <Skeleton className='h-[14px] w-[70%]' />
            <Skeleton className='h-[14px] w-[60%]' />
          </div>
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-[14px] w-[80%]' />
            <Skeleton className='h-[14px] w-[65%]' />
          </div>
        </div>
      </div>
    ))}
  </div>
)

const pptxSlideCache = new Map<string, string[]>()

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
}

function shouldSuppressStreamingPptxError(message: string): boolean {
  return (
    shouldSuppressStreamingDocumentError(message) ||
    message.includes('SyntaxError: Invalid or unexpected token') ||
    message.includes('PPTX generation cancelled') ||
    message.includes('SyntaxError: Unexpected end of input')
  )
}

function pptxCacheSet(key: string, slides: string[]): void {
  pptxSlideCache.set(key, slides)
  if (pptxSlideCache.size > 5) {
    const oldest = pptxSlideCache.keys().next().value
    if (oldest !== undefined) pptxSlideCache.delete(oldest)
  }
}

async function renderPptxSlides(
  data: Uint8Array,
  onSlide: (src: string, index: number) => void,
  cancelled: () => boolean
): Promise<void> {
  const { PPTXViewer } = await import('pptxviewjs')
  if (cancelled()) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const { width, height } = await getPptxRenderSize(data, dpr)
  const W = width
  const H = height

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const viewer = new PPTXViewer({ canvas })
  await viewer.loadFile(data)
  const count = viewer.getSlideCount()
  if (cancelled() || count === 0) return

  for (let i = 0; i < count; i++) {
    if (cancelled()) break
    if (i === 0) await viewer.render()
    else await viewer.goToSlide(i)
    onSlide(canvas.toDataURL('image/jpeg', 0.85), i)
  }
}

async function getPptxRenderSize(
  data: Uint8Array,
  dpr: number
): Promise<{ width: number; height: number }> {
  const fallback = {
    width: Math.round(1920 * dpr),
    height: Math.round(1080 * dpr),
  }

  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(data)
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text')
    if (!presentationXml) return fallback

    const tagMatch = presentationXml.match(/<p:sldSz\s[^>]+>/)
    if (!tagMatch) return fallback
    const tag = tagMatch[0]
    const cxMatch = tag.match(/\bcx="(\d+)"/)
    const cyMatch = tag.match(/\bcy="(\d+)"/)
    if (!cxMatch || !cyMatch) return fallback

    const cx = Number(cxMatch[1])
    const cy = Number(cyMatch[1])
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return fallback

    const aspectRatio = cx / cy
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return fallback

    const baseLongEdge = 1920 * dpr
    if (aspectRatio >= 1) {
      return {
        width: Math.round(baseLongEdge),
        height: Math.round(baseLongEdge / aspectRatio),
      }
    }

    return {
      width: Math.round(baseLongEdge * aspectRatio),
      height: Math.round(baseLongEdge),
    }
  } catch {
    return fallback
  }
}

export function PptxPreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const {
    data: fileData,
    isLoading: isFetching,
    error: fetchError,
    dataUpdatedAt,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)

  const cacheKey = pptxCacheKey(file.id, dataUpdatedAt, fileData?.byteLength ?? 0)
  const cached = pptxSlideCache.get(cacheKey)

  const [slides, setSlides] = useState<string[]>(cached ?? [])
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (streamingContent === undefined) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      if (cancelled) return
      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/pptx/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }
        if (cancelled) return
        const arrayBuffer = await response.arrayBuffer()
        if (cancelled) return
        const data = new Uint8Array(arrayBuffer)
        const images: string[] = []
        await renderPptxSlides(
          data,
          (src) => {
            images.push(src)
            if (!cancelled) setSlides([...images])
          },
          () => cancelled
        )
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = toError(err).message || 'Failed to render presentation'
          if (shouldSuppressStreamingPptxError(msg)) {
            logger.info('Suppressing transient PPTX streaming preview error', { error: msg })
          } else {
            logger.error('PPTX render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  useEffect(() => {
    if (streamingContent !== undefined) return

    let cancelled = false

    async function render() {
      if (cancelled) return
      try {
        if (cached) {
          setSlides(cached)
          return
        }

        if (!fileData) return
        setRendering(true)
        setRenderError(null)
        setSlides([])
        const data = new Uint8Array(fileData)
        const images: string[] = []
        await renderPptxSlides(
          data,
          (src) => {
            images.push(src)
            if (!cancelled) setSlides([...images])
          },
          () => cancelled
        )
        if (!cancelled && images.length > 0) {
          pptxCacheSet(cacheKey, images)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to render presentation'
          logger.error('PPTX render failed', { error: msg })
          setRenderError(msg)
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [fileData, streamingContent, cacheKey])

  const error = resolvePreviewError(fetchError, renderError)
  const loading = isFetching || rendering

  if (error) return <PreviewError label='presentation' error={error} />

  if (loading && slides.length === 0) {
    return PPTX_SLIDE_SKELETON
  }

  return (
    <div className='flex-1 overflow-y-auto bg-[var(--surface-1)] p-[24px]'>
      <div className='mx-auto flex max-w-[960px] flex-col gap-[16px]'>
        {slides.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Slide ${i + 1}`}
            className='w-full rounded-md shadow-medium'
          />
        ))}
      </div>
    </div>
  )
}
