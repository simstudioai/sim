import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
} as const

/** Only fixture sessions can read the prebuilt legacy document and its hashed assets. */
export async function GET(
  _request: Request,
  context: RouteContext<'/preview-workspace/[...assets]'>
) {
  if (resolvePlatformMode() !== 'fixture') return new Response(null, { status: 404 })
  const { assets } = await context.params
  const filename = assets.join('/')
  const suffix =
    filename === 'index.html' ? 'html' : /^assets\/[\w.-]+\.(js|css)$/.exec(filename)?.[1]
  if (suffix !== 'html' && suffix !== 'js' && suffix !== 'css') {
    return new Response(null, { status: 404 })
  }

  // Next accepts its project directory relative to the launcher's working directory.
  for (const project of ['.', 'platform', 'apps/sim/platform']) {
    try {
      const content = await readFile(
        path.join(process.cwd(), project, 'dist/workspace-preview', filename)
      )
      return new Response(new Uint8Array(content), {
        headers: { 'Content-Type': CONTENT_TYPES[suffix], 'Cache-Control': 'private, no-store' },
      })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  return new Response(null, { status: 404 })
}
