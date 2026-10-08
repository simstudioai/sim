import { PASTE_LIMITS } from '@sim/utils/paste'

export const MAX_TEXT_PREVIEW_BYTES = PASTE_LIMITS.TEXT_EDITOR_BYTES

export const TEXT_PREVIEW_SIZE_MESSAGE =
  'This file is too large to preview. Download it to view its contents.'

class FileTextSizeError extends Error {
  constructor() {
    super(TEXT_PREVIEW_SIZE_MESSAGE)
    this.name = 'FileTextSizeError'
  }
}

/** Bounds text previews even when storage omits or underreports Content-Length. */
export async function readFileText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_TEXT_PREVIEW_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new FileTextSizeError()
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_TEXT_PREVIEW_BYTES) throw new FileTextSizeError()
      const text = decoder.decode(value, { stream: true })
      if (text) chunks.push(text)
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
