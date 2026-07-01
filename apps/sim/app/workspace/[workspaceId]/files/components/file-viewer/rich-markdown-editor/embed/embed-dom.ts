import type { EmbedInfo } from '@sim/utils/media-embed'

/**
 * Iframes are rendered at native size then CSS-scaled down so embedded players keep their
 * intended layout inside the editor's reading column. Mirrors the note-block renderer.
 */
const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`

const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

/**
 * Build the DOM player for a resolved {@link EmbedInfo}, matching the note-block renderer's
 * markup. Returned as a non-editable element so it can back a ProseMirror widget decoration
 * without entering the editable content.
 */
export function createEmbedDom(embedInfo: EmbedInfo): HTMLElement {
  const container = document.createElement('div')
  container.className = 'my-2 block w-full overflow-hidden rounded-md'
  container.contentEditable = 'false'

  if (embedInfo.type === 'iframe') {
    const frame = document.createElement('div')
    frame.className = 'block overflow-hidden'
    frame.style.width = '100%'
    frame.style.aspectRatio = embedInfo.aspectRatio || '16/9'

    const iframe = document.createElement('iframe')
    iframe.src = embedInfo.url
    iframe.title = 'Media'
    iframe.allow = IFRAME_ALLOW
    iframe.allowFullscreen = true
    iframe.loading = 'lazy'
    iframe.className = 'origin-top-left'
    iframe.style.width = EMBED_INVERSE_SCALE
    iframe.style.height = EMBED_INVERSE_SCALE
    iframe.style.transform = `scale(${EMBED_SCALE})`

    frame.appendChild(iframe)
    container.appendChild(frame)
    return container
  }

  if (embedInfo.type === 'video') {
    const video = document.createElement('video')
    video.src = embedInfo.url
    video.controls = true
    video.preload = 'metadata'
    video.className = 'aspect-video w-full'
    container.appendChild(video)
    return container
  }

  const audio = document.createElement('audio')
  audio.src = embedInfo.url
  audio.controls = true
  audio.preload = 'metadata'
  audio.className = 'w-full'
  container.appendChild(audio)
  return container
}
