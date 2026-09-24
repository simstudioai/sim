/**
 * How a declared sandbox output path is read back and, therefore, how its content must be
 * decoded. The reader (remote-sandbox) and the exporter (function-execution) must agree
 * on this per path: a `.jpg` read as base64 and then classified as text by its (unknown)
 * output format was stored verbatim as base64 text under an `image/jpeg`-less name.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.zip',
  '.mp3',
  '.mp4',
  '.docx',
  '.pptx',
  '.xlsx',
])

/**
 * True when a declared output path is read from the sandbox as base64 bytes rather than
 * UTF-8 text.
 */
export function isBinarySandboxPath(sandboxPath: string): boolean {
  const ext = sandboxPath.slice(sandboxPath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}
