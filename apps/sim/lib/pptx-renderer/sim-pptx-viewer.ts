import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { ListRenderOptions } from '@/lib/pptx-renderer/core/viewer'
import { PptxViewer } from '@/lib/pptx-renderer/core/viewer'
import type { ZipParseLimits } from '@/lib/pptx-renderer/parser/zip-parser'

const logger = createLogger('SimPptxViewer')

export const SIM_PPTX_ZIP_LIMITS = {
  maxEntries: 2500,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxMediaBytes: 150 * 1024 * 1024,
  maxConcurrency: 8,
} as const satisfies ZipParseLimits

export const SIM_PPTX_LIST_OPTIONS = {
  windowed: true,
  batchSize: 8,
  initialSlides: 4,
  overscanViewport: 1.5,
} as const satisfies ListRenderOptions

export interface OpenSimPptxViewerOptions {
  buffer: ArrayBuffer | Uint8Array
  container: HTMLElement
  scrollContainer?: HTMLElement
  signal?: AbortSignal
  zipLimits?: ZipParseLimits
  listOptions?: ListRenderOptions
  onRenderStart?: () => void
  onRenderComplete?: () => void
  onSlideChange?: (index: number) => void
  onSlideError?: (index: number, error: unknown) => void
  onNodeError?: (nodeId: string, error: unknown) => void
}

export interface SimPptxViewerHandle {
  readonly viewer: PptxViewer
  destroy(): void
}

export async function openSimPptxViewer({
  buffer,
  container,
  scrollContainer,
  signal,
  zipLimits = SIM_PPTX_ZIP_LIMITS,
  listOptions = SIM_PPTX_LIST_OPTIONS,
  onRenderStart,
  onRenderComplete,
  onSlideChange,
  onSlideError,
  onNodeError,
}: OpenSimPptxViewerOptions): Promise<SimPptxViewerHandle> {
  const viewer = new PptxViewer(container, {
    fitMode: 'contain',
    scrollContainer,
    zipLimits,
    onRenderStart,
    onRenderComplete,
    onSlideChange,
    onSlideError,
    onNodeError,
  })

  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    viewer.destroy()
  }

  const abortDestroy = () => destroy()
  signal?.addEventListener('abort', abortDestroy, { once: true })

  try {
    await viewer.open(buffer, {
      renderMode: 'list',
      listOptions,
      signal,
    })
  } catch (error) {
    destroy()
    const normalized = toError(error)
    if (normalized.name !== 'AbortError') {
      logger.warn('Failed to render PPTX preview', { error: normalized.message })
    }
    throw normalized
  } finally {
    signal?.removeEventListener('abort', abortDestroy)
  }

  return { viewer, destroy }
}
