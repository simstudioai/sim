import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { Session } from 'electron'
import { protocol } from 'electron'

const logger = createLogger('DesktopLocalPages')

/**
 * The scheme the shell serves its bundled pages from.
 *
 * Not `file:`. The packaged app disables the `grantFileProtocolExtraPrivileges`
 * fuse, and with it Electron stops routing `file:` navigations through its
 * asar-aware loader: Chromium looks for a real path inside `app.asar`, fails
 * with ERR_FILE_NOT_FOUND, and the window shows nothing but its background
 * colour. Unpackaged runs never see this — no asar, default fuses — which is
 * how the offline page and the server picker shipped blank. A privileged custom
 * scheme is what Electron's fuse documentation asks for instead: the main
 * process reads the files itself, where Node's asar support applies.
 * `standard` gives the pages a real origin (`sim-shell://pages`), so `'self'`
 * in their CSP resolves the bundled font.
 */
export const LOCAL_PAGE_SCHEME = 'sim-shell'
const LOCAL_PAGE_HOST = 'pages'
export const LOCAL_PAGE_ORIGIN = `${LOCAL_PAGE_SCHEME}://${LOCAL_PAGE_HOST}`

export type LocalPage = 'offline.html' | 'server.html'

const LOCAL_PAGES: ReadonlySet<string> = new Set<LocalPage>(['offline.html', 'server.html'])

/**
 * Every file the scheme serves. An exact-name allowlist rather than a
 * directory walk: nothing outside it can be requested however the path is
 * spelled, and adding an asset is a deliberate one-line change.
 */
const SERVABLE_FILES: ReadonlySet<string> = new Set([...LOCAL_PAGES, 'SeasonSansUprightsVF.woff2'])

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
}

/** Builds the URL of a bundled page, with its query encoded. */
export function localPageUrl(page: LocalPage, query?: Readonly<Record<string, string>>): string {
  const url = new URL(`${LOCAL_PAGE_ORIGIN}/${page}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * Whether a frame URL is one of the bundled pages. The IPC gate for shell
 * control runs on this, so scheme, host, and path must match exactly; only
 * the query is ignored.
 */
export function isLocalPageUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== `${LOCAL_PAGE_SCHEME}:` || url.host !== LOCAL_PAGE_HOST) {
    return false
  }
  return LOCAL_PAGES.has(url.pathname.slice(1))
}

/**
 * Declares the scheme's privileges. Electron requires this before the app is
 * ready, so it runs at module load in `index.ts`.
 */
export function registerLocalPageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_PAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        allowServiceWorkers: false,
        bypassCSP: false,
        stream: false,
      },
    },
  ])
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

/**
 * Serves allowlisted files from `rootDir`. Split from the session wiring so
 * tests can drive it against a temporary directory.
 */
export function createLocalPageHandler(rootDir: string): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405 })
    }
    let name: string
    try {
      const url = new URL(request.url)
      if (url.host !== LOCAL_PAGE_HOST) {
        return notFound()
      }
      name = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return notFound()
    }
    if (!SERVABLE_FILES.has(name)) {
      return notFound()
    }
    try {
      const file = await readFile(join(rootDir, name))
      // A copy into a plain ArrayBuffer: Response bodies take BufferSource, and
      // a Node Buffer's backing store is not typed as one.
      const body = new Uint8Array(file.byteLength)
      body.set(file)
      return new Response(body.buffer, {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES[extname(name)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      logger.error('Could not read a bundled page asset', { name, error: getErrorMessage(error) })
      return notFound()
    }
  }
}

/**
 * The bundled `static/` directory. `__dirname` is `dist/` in every build, so
 * this holds inside the packaged asar as well as in an unpackaged checkout.
 */
function localPageRoot(): string {
  return join(__dirname, '..', 'static')
}

/**
 * Serves the scheme on a session. Handlers are per session, so every partition
 * that hosts a bundled page installs one; repeat calls are no-ops.
 */
export function attachLocalPageProtocol(ses: Session, rootDir: string = localPageRoot()): void {
  if (ses.protocol.isProtocolHandled(LOCAL_PAGE_SCHEME)) {
    return
  }
  ses.protocol.handle(LOCAL_PAGE_SCHEME, createLocalPageHandler(rootDir))
}
