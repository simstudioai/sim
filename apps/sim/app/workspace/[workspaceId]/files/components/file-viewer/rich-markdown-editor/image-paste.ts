import { Fragment, type Node, Slice } from '@tiptap/pm/model'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

/** Clipboard image files may be exposed only through `items`, rather than `files`. */
export function extractImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  const fromFiles = Array.from(transfer.files).filter((file) => file.type.startsWith('image/'))
  if (fromFiles.length > 0) return fromFiles
  return Array.from(transfer.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

function runtimeOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

export interface ImageFileFallback {
  slice: Slice
  source: string
}

function isNonPortableImageSource(src: string): boolean {
  try {
    const url = new URL(src, runtimeOrigin() || 'http://placeholder')
    return (
      url.protocol === 'blob:' ||
      /^\/api\/(?:workspaces\/[^/]+\/files|files\/public\/[^/]+)\/inline$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

/** Associate a single attached bitmap with its source, without guessing a multi-file ordering. */
export function getImageFileFallback(
  slice: Slice,
  files: readonly File[]
): ImageFileFallback | null {
  if (files.length !== 1) return null
  const sources = new Set<string>()
  slice.content.descendants((node) => {
    if (
      isImageNode(node) &&
      typeof node.attrs.src === 'string' &&
      isNonPortableImageSource(node.attrs.src)
    ) {
      sources.add(node.attrs.src)
    }
  })
  return sources.size === 1 ? { slice, source: sources.values().next().value! } : null
}

/** Replace the uploaded image's source while retaining the original fragment and node attributes. */
export function resolveImageFileFallback(fallback: ImageFileFallback, uploadedSrc: string): Slice {
  return mapImageSources(fallback.slice, (src) => (src === fallback.source ? uploadedSrc : src))
}

/** Normalize native clipboard URLs against the actual page origin, never another host. */
export function toSameOriginPath(src: string, origin = runtimeOrigin()): string | null {
  try {
    const base = origin || 'http://placeholder'
    const parsed = new URL(src, base)
    if (parsed.origin !== base) return null
    return parsed.pathname + parsed.search
  } catch {
    return null
  }
}

/**
 * Restore recognized stored image references without replacing the rest of the pasted fragment.
 * Display-only routes are resolved only through images already present in this document.
 */
export function normalizePastedImageSources(
  slice: Slice,
  doc: Node,
  resolveSrc: (src: string | undefined) => string | undefined = (src) => src,
  origin = runtimeOrigin()
): Slice {
  let hasImage = false
  slice.content.descendants((node) => {
    if (isImageNode(node)) hasImage = true
    return !hasImage
  })
  if (!hasImage) return slice
  const sources = new Map<string, string>()
  doc.descendants((node) => {
    if (!isImageNode(node) || typeof node.attrs.src !== 'string') return
    const resolved = resolveSrc(node.attrs.src)
    if (!resolved) return
    const path = toSameOriginPath(resolved, origin)
    if (path) sources.set(path, node.attrs.src)
  })
  return mapImageSources(slice, (source) => {
    const path = toSameOriginPath(source, origin)
    return (path && (sources.get(path) ?? (extractEmbeddedFileRef(path) ? path : null))) || source
  })
}

function mapImageSources(slice: Slice, map: (src: string) => string): Slice {
  let changed = false
  const normalize = (fragment: Fragment): Fragment => {
    const children: Node[] = []
    fragment.forEach((node) => {
      if (isImageNode(node) && typeof node.attrs.src === 'string') {
        const src = map(node.attrs.src)
        if (src !== node.attrs.src) {
          changed = true
          children.push(node.type.create({ ...node.attrs, src }, node.content, node.marks))
        } else children.push(node)
      } else {
        children.push(node.isLeaf ? node : node.copy(normalize(node.content)))
      }
    })
    return Fragment.fromArray(children)
  }
  const content = normalize(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}
