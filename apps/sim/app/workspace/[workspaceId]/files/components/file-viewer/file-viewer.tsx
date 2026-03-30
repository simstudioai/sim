'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileBinary,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { useAutosave } from '@/hooks/use-autosave'
import { useStreamingText } from '@/hooks/use-streaming-text'
import { PreviewPanel, resolvePreviewType } from './preview-panel'

const logger = createLogger('FileViewer')

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50

const TEXT_EDITABLE_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
  'application/x-yaml',
  'text/csv',
  'text/html',
  'image/svg+xml',
])

const TEXT_EDITABLE_EXTENSIONS = new Set([
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'html',
  'htm',
  'svg',
])

const IFRAME_PREVIEWABLE_MIME_TYPES = new Set(['application/pdf'])
const IFRAME_PREVIEWABLE_EXTENSIONS = new Set(['pdf'])

const IMAGE_PREVIEWABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_PREVIEWABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

const PPTX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])
const PPTX_PREVIEWABLE_EXTENSIONS = new Set(['pptx'])

type FileCategory =
  | 'text-editable'
  | 'iframe-previewable'
  | 'image-previewable'
  | 'pptx-previewable'
  | 'unsupported'

function resolveFileCategory(mimeType: string | null, filename: string): FileCategory {
  if (mimeType && TEXT_EDITABLE_MIME_TYPES.has(mimeType)) return 'text-editable'
  if (mimeType && IFRAME_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'iframe-previewable'
  if (mimeType && IMAGE_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'image-previewable'
  if (mimeType && PPTX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'pptx-previewable'

  const ext = getFileExtension(filename)
  if (TEXT_EDITABLE_EXTENSIONS.has(ext)) return 'text-editable'
  if (IFRAME_PREVIEWABLE_EXTENSIONS.has(ext)) return 'iframe-previewable'
  if (IMAGE_PREVIEWABLE_EXTENSIONS.has(ext)) return 'image-previewable'
  if (PPTX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'pptx-previewable'

  return 'unsupported'
}

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}

export type PreviewMode = 'editor' | 'split' | 'preview'

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  showPreview?: boolean
  previewMode?: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
}

export function FileViewer({
  file,
  workspaceId,
  canEdit,
  showPreview,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={streamingContent !== undefined ? false : canEdit}
        previewMode={previewMode ?? (showPreview ? 'preview' : 'editor')}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        streamingContent={streamingContent}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return <IframePreview file={file} />
  }

  if (category === 'image-previewable') {
    return <ImagePreview file={file} />
  }

  if (category === 'pptx-previewable') {
    return <PptxPreview file={file} workspaceId={workspaceId} streamingContent={streamingContent} />
  }

  return <UnsupportedPreview file={file} />
}

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
}

function TextEditor({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
}: TextEditorProps) {
  const initializedRef = useRef(false)
  const contentRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [isResizing, setIsResizing] = useState(false)

  const {
    data: fetchedContent,
    isLoading,
    error,
    dataUpdatedAt,
  } = useWorkspaceFileContent(workspaceId, file.id, file.key, file.type === 'text/x-pptxgenjs')

  const updateContent = useUpdateWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)
  updateContentRef.current = updateContent

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const savedContentRef = useRef('')

  useEffect(() => {
    if (streamingContent !== undefined) {
      setContent(streamingContent)
      contentRef.current = streamingContent
      initializedRef.current = true
      return
    }

    if (fetchedContent === undefined) return

    if (!initializedRef.current) {
      setContent(fetchedContent)
      setSavedContent(fetchedContent)
      savedContentRef.current = fetchedContent
      contentRef.current = fetchedContent
      initializedRef.current = true

      if (autoFocus) {
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
      return
    }

    if (fetchedContent === savedContentRef.current) return
    const isClean = contentRef.current === savedContentRef.current
    if (isClean) {
      setContent(fetchedContent)
      setSavedContent(fetchedContent)
      savedContentRef.current = fetchedContent
      contentRef.current = fetchedContent
    }
  }, [streamingContent, fetchedContent, dataUpdatedAt, autoFocus])

  const handleContentChange = useCallback((value: string) => {
    setContent(value)
    contentRef.current = value
  }, [])

  const onSave = useCallback(async () => {
    const currentContent = contentRef.current
    if (currentContent === savedContentRef.current) return

    await updateContentRef.current.mutateAsync({
      workspaceId,
      fileId: file.id,
      content: currentContent,
    })
    setSavedContent(currentContent)
    savedContentRef.current = currentContent
  }, [workspaceId, file.id])

  const { saveStatus, saveImmediately, isDirty } = useAutosave({
    content,
    savedContent,
    onSave,
    enabled: canEdit && initializedRef.current,
  })

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    onSaveStatusChange?.(saveStatus)
  }, [saveStatus, onSaveStatusChange])

  if (saveRef) saveRef.current = saveImmediately
  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null
    },
    [saveRef]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)))
    }

    const handleMouseUp = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  const handleCheckboxToggle = useCallback(
    (checkboxIndex: number, checked: boolean) => {
      const toggled = toggleMarkdownCheckbox(contentRef.current, checkboxIndex, checked)
      if (toggled !== contentRef.current) {
        handleContentChange(toggled)
      }
    },
    [handleContentChange]
  )

  const isStreaming = streamingContent !== undefined
  const revealedContent = useStreamingText(content, isStreaming)

  const textareaStuckRef = useRef(true)

  useEffect(() => {
    if (!isStreaming) return
    textareaStuckRef.current = true

    const el = textareaRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) textareaStuckRef.current = false
    }

    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      if (dist <= 5) textareaStuckRef.current = true
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
    }
  }, [isStreaming])

  useEffect(() => {
    if (!isStreaming || !textareaStuckRef.current) return
    const el = textareaRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [isStreaming, revealedContent])

  if (streamingContent === undefined) {
    if (isLoading) {
      return (
        <div className='flex flex-1 flex-col gap-[8px] p-[24px]'>
          <Skeleton className='h-[16px] w-[60%]' />
          <Skeleton className='h-[16px] w-[80%]' />
          <Skeleton className='h-[16px] w-[40%]' />
          <Skeleton className='h-[16px] w-[70%]' />
        </div>
      )
    }

    if (error) {
      return (
        <div className='flex flex-1 items-center justify-center'>
          <p className='text-[13px] text-[var(--text-muted)]'>Failed to load file content</p>
        </div>
      )
    }
  }

  const previewType = resolvePreviewType(file.type, file.name)
  const isIframeRendered = previewType === 'html' || previewType === 'svg'
  const effectiveMode = isStreaming && isIframeRendered ? 'editor' : previewMode
  const showEditor = effectiveMode !== 'preview'
  const showPreviewPane = effectiveMode !== 'editor'

  return (
    <div ref={containerRef} className='relative flex flex-1 overflow-hidden'>
      {showEditor && (
        <textarea
          ref={textareaRef}
          value={isStreaming ? revealedContent : content}
          onChange={(e) => handleContentChange(e.target.value)}
          readOnly={!canEdit}
          spellCheck={false}
          style={showPreviewPane ? { width: `${splitPct}%`, flexShrink: 0 } : undefined}
          className={cn(
            'h-full resize-none border-0 bg-transparent p-[24px] font-mono text-[14px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-subtle)]',
            !showPreviewPane && 'w-full',
            isResizing && 'pointer-events-none'
          )}
        />
      )}
      {showPreviewPane && (
        <>
          {showEditor && (
            <div className='relative shrink-0'>
              <div className='h-full w-px bg-[var(--border)]' />
              <div
                className='-left-[3px] absolute top-0 z-10 h-full w-[6px] cursor-col-resize'
                onMouseDown={() => setIsResizing(true)}
                role='separator'
                aria-orientation='vertical'
                aria-label='Resize split'
              />
              {isResizing && (
                <div className='-translate-x-[0.5px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]' />
              )}
            </div>
          )}
          <div
            className={cn('min-w-0 flex-1 overflow-hidden', isResizing && 'pointer-events-none')}
          >
            <PreviewPanel
              content={isStreaming ? revealedContent : content}
              mimeType={file.type}
              filename={file.name}
              isStreaming={isStreaming}
              onCheckboxToggle={canEdit && !isStreaming ? handleCheckboxToggle : undefined}
            />
          </div>
        </>
      )}
    </div>
  )
}

const IframePreview = memo(function IframePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`

  return (
    <div className='flex flex-1 overflow-hidden'>
      <iframe
        src={serveUrl}
        className='h-full w-full border-0'
        title={file.name}
        onError={() => {
          logger.error(`Failed to load file: ${file.name}`)
        }}
      />
    </div>
  )
})

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_WHEEL_SENSITIVITY = 0.005
const ZOOM_BUTTON_FACTOR = 1.2

const clampZoom = (z: number) => Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX)

const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetAtDragStart = useRef({ x: 0, y: 0 })
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const containerRef = useRef<HTMLDivElement>(null)

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_BUTTON_FACTOR)), [])
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_BUTTON_FACTOR)), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetAtDragStart.current = offsetRef.current
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    setOffset({
      x: offsetAtDragStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetAtDragStart.current.y + (e.clientY - dragStart.current.y),
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }, [])

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [file.key])

  return (
    <div
      ref={containerRef}
      className='relative flex flex-1 cursor-grab overflow-hidden bg-[var(--surface-1)]'
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className='pointer-events-none absolute inset-0 flex items-center justify-center'
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <img
          src={serveUrl}
          alt={file.name}
          className='max-h-full max-w-full select-none rounded-md object-contain'
          draggable={false}
          loading='eager'
        />
      </div>
      <div
        className='absolute right-4 bottom-4 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-sm'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type='button'
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          className='flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40'
          aria-label='Zoom out'
        >
          <ZoomOut className='h-3.5 w-3.5' />
        </button>
        <span className='min-w-[3rem] text-center text-[11px] text-[var(--text-secondary)]'>
          {Math.round(zoom * 100)}%
        </span>
        <button
          type='button'
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          className='flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40'
          aria-label='Zoom in'
        >
          <ZoomIn className='h-3.5 w-3.5' />
        </button>
      </div>
    </div>
  )
})

const pptxSlideCache = new Map<string, string[]>()

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
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

function PptxPreview({
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

  // Streaming preview: only re-triggers when the streaming source code or
  // workspace changes. Isolated from fileData/dataUpdatedAt so that file-list
  // refreshes don't abort the in-flight compilation request.
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
          const msg = err instanceof Error ? err.message : 'Failed to render presentation'
          logger.error('PPTX render failed', { error: msg })
          setRenderError(msg)
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

  // Non-streaming render: uses the fetched binary directly on the client.
  // Skipped while streaming is active so it doesn't interfere.
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
          const msg = err instanceof Error ? err.message : 'Failed to render presentation'
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
  }, [fileData, dataUpdatedAt, streamingContent, cacheKey, workspaceId])

  const error = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : 'Failed to load file'
    : renderError
  const loading = isFetching || rendering

  if (error) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
        <p className='font-medium text-[14px] text-[var(--text-body)]'>
          Failed to preview presentation
        </p>
        <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
      </div>
    )
  }

  if (loading && slides.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center bg-[var(--surface-1)]'>
        <div className='flex flex-col items-center gap-[8px]'>
          <div
            className='h-[18px] w-[18px] animate-spin rounded-full'
            style={{
              background:
                'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
            }}
          />
          <p className='text-[13px] text-[var(--text-muted)]'>Loading presentation...</p>
        </div>
      </div>
    )
  }

  return (
    <div className='flex-1 overflow-y-auto bg-[var(--surface-1)] p-[24px]'>
      <div className='mx-auto flex max-w-[960px] flex-col gap-[16px]'>
        {slides.map((src, i) => (
          <img key={i} src={src} alt={`Slide ${i + 1}`} className='w-full rounded-md shadow-lg' />
        ))}
      </div>
    </div>
  )
}

function toggleMarkdownCheckbox(markdown: string, targetIndex: number, checked: boolean): string {
  let currentIndex = 0
  return markdown.replace(/^(\s*(?:[-*+]|\d+[.)]) +)\[([ xX])\]/gm, (match, prefix: string) => {
    if (currentIndex++ !== targetIndex) return match
    return `${prefix}[${checked ? 'x' : ' '}]`
  })
}

const UnsupportedPreview = memo(function UnsupportedPreview({
  file,
}: {
  file: WorkspaceFileRecord
}) {
  const ext = getFileExtension(file.name)

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>
        Preview not available{ext ? ` for .${ext} files` : ' for this file'}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>
        Use the download button to view this file
      </p>
    </div>
  )
})
