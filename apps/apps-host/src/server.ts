/**
 * Apps-domain static host + action reverse proxy.
 *
 * Local two-host recipe:
 *   NEXT_PUBLIC_APP_URL=http://sim.localhost:3000
 *   APP_PUBLIC_ORIGIN=http://apps.localhost:3005
 *   APPS_PROXY_HOP_SECRET=<32+ chars>
 *   bun run --filter apps-host dev
 *
 * Public URLs: /a/{publicId}/{slug}
 * Actions:     /__sim/actions/releases/{releaseId}/actions/{actionId}
 * Abuse:       POST /__sim/abuse/session  (Turnstile → abuse token)
 * Preview:     /__sim/preview/{sessionId}/{channelNonce}/?parentOrigin=
 */

import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { createAppsHopProof } from './hop'
import {
  appDirectoryRedirect,
  isPublishedDocumentRequest,
  isValidPreviewChannelNonce,
  normalizePreviewParentOrigin,
  safeJsonForScript,
  ttlLruGet,
  ttlLruSet,
} from './preview-security'

const PORT = Number(process.env.APPS_HOST_PORT || 3005)
const SIM_URL = (
  process.env.APPS_INTERNAL_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  ''
).replace(/\/$/, '')
const HOP_SECRET = (process.env.APPS_PROXY_HOP_SECRET || '').trim()
const ARTIFACT_ROOT_ENV = (process.env.APPS_ARTIFACT_ROOT || '').trim()
const ARTIFACT_ROOT = resolve(ARTIFACT_ROOT_ENV || './.artifacts')
const PUBLIC_ORIGIN = (process.env.APP_PUBLIC_ORIGIN || `http://localhost:${PORT}`).replace(
  /\/$/,
  ''
)
/** Published CSP allows style-src unsafe-inline for React style props — intentional isolated-origin compromise. */
const PUBLISHED_STYLE_SRC = "'self' 'unsafe-inline'"

/** Exact origins allowed in preview-shell frame-ancestors / parentOrigin query. */
function allowedPreviewParentOrigins(): Set<string> {
  const raw = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.APPS_PREVIEW_PARENT_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  const origins = new Set<string>()
  for (const entry of raw) {
    try {
      origins.add(new URL(entry).origin)
    } catch {
      // ignore malformed
    }
  }
  return origins
}

function isAllowedPreviewParentOrigin(origin: string): boolean {
  const normalized = normalizePreviewParentOrigin(origin)
  if (!normalized) return false
  const allowed = allowedPreviewParentOrigins()
  if (allowed.size === 0) {
    // Fail closed when Sim origin env is unset — do not embed arbitrary parents in CSP.
    return false
  }
  return allowed.has(normalized)
}

if (!SIM_URL) {
  console.error('apps-host: APPS_INTERNAL_GATEWAY_URL or NEXT_PUBLIC_APP_URL is required')
  process.exit(1)
}
if (HOP_SECRET.length < 32) {
  console.error('apps-host: APPS_PROXY_HOP_SECRET must be at least 32 characters')
  process.exit(1)
}
if (!ARTIFACT_ROOT_ENV) {
  console.error(
    'apps-host: APPS_ARTIFACT_ROOT must be set to the same absolute path Sim uses for real artifact serving'
  )
  process.exit(1)
}

/** Only forward safe request headers to Sim — never cookies, auth, or spoofable client IP headers. */
const HOP_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'content-type',
  'content-length',
  'origin',
  'referer',
  'user-agent',
  'x-sim-apps-abuse-token',
  'x-request-id',
])

const TOMBSTONE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Unavailable</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0d10;color:#e8eaed}
main{max-width:28rem;text-align:center;padding:2rem}h1{font-size:1.25rem;font-weight:600}p{opacity:.7;line-height:1.5}</style>
</head><body><main><h1>This app is unavailable</h1><p>The published release was revoked or is no longer current.</p></main></body></html>`

/** Minimal published SDK for the hand-authored fixture shell (mirrors @sim/app-sdk abuse refresh). */
const FIXTURE_SDK_JS = `export function createSimClient(options) {
  async function bootstrapAbuseToken(config) {
    let visitorId = localStorage.getItem('sim_visitor_id')
    if (!visitorId) {
      visitorId = crypto.randomUUID()
      localStorage.setItem('sim_visitor_id', visitorId)
    }
    const res = await fetch('/__sim/abuse/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicId: config.publicId, visitorId }),
    })
    const json = await res.json()
    const token = json?.abuseToken || json?.data?.abuseToken
    if (!res.ok || !token) throw new Error(json?.error || 'Abuse session failed')
    sessionStorage.setItem('sim_abuse_token', token)
    return token
  }

  async function ensureAbuseToken(config, forceRefresh) {
    if (typeof options.getAbuseToken === 'function' && !forceRefresh) {
      return options.getAbuseToken()
    }
    if (!forceRefresh) {
      const existing = sessionStorage.getItem('sim_abuse_token')
      if (existing) return existing
    } else {
      sessionStorage.removeItem('sim_abuse_token')
    }
    return bootstrapAbuseToken(config)
  }

  return {
    async run(actionId, input = {}) {
      if (options.mode === 'preview') {
        const requestId = crypto.randomUUID()
        return options.postMessage({ type: 'sim.run', actionId, input, requestId })
      }
      const config = options.config
      const url = config.gatewayOrigin.replace(/\\/$/, '') +
        '/__sim/actions/releases/' + config.releaseId + '/actions/' + encodeURIComponent(actionId)
      async function post(token) {
        return fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sim-apps-abuse-token': token,
          },
          body: JSON.stringify({ input }),
        })
      }
      let abuseToken = await ensureAbuseToken(config, false)
      let res = await post(abuseToken)
      let json = await res.json()
      if (!res.ok && (json.code === 'ABUSE_TOKEN_REQUIRED' || res.status === 403)) {
        abuseToken = await ensureAbuseToken(config, true)
        res = await post(abuseToken)
        json = await res.json()
      }
      if (!res.ok) return { success: false, outputs: {}, error: json.error || 'Request failed' }
      if (json.data) return json.data
      return { success: true, executionId: json.executionId, outputs: json.outputs || {} }
    },
  }
}
`

type AppsHostServer = {
  requestIP?: (req: Request) => string | { address: string } | null | undefined
}

function clientIpFromSocket(server: AppsHostServer, req: Request): string {
  try {
    const ip = server.requestIP?.(req)
    if (ip && typeof ip === 'object' && 'address' in ip) {
      return String(ip.address)
    }
    if (typeof ip === 'string' && ip) return ip
  } catch {
    // ignore
  }
  return '0.0.0.0'
}

async function proxyToSim(
  req: Request,
  simPath: string,
  server: AppsHostServer
): Promise<Response> {
  const url = new URL(req.url)
  const target = `${SIM_URL}${simPath}${url.search}`
  const headers = new Headers()
  for (const [key, value] of req.headers.entries()) {
    if (HOP_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  headers.set('x-sim-apps-hop', createAppsHopProof(HOP_SECRET, req.method, simPath))
  headers.set('x-forwarded-for', clientIpFromSocket(server, req))
  headers.set('x-real-ip', clientIpFromSocket(server, req))

  const init: RequestInit = {
    method: req.method,
    headers,
    duplex: 'half',
  } as RequestInit

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body
  }

  return fetch(target, init)
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.woff')) return 'font/woff'
  if (path.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
}

type HostArtifactManifest = {
  version: number
  entrypoint: string
  files: Array<{ path: string; hash: string; byteSize: number; contentType: string }>
}

const MANIFEST_CACHE_MAX = 128
/** Cap verified blob cache by total bytes (~128 MiB), not entry count. */
const BLOB_CACHE_MAX_BYTES = 128 * 1024 * 1024
const manifestCache = new Map<string, HostArtifactManifest>()
const verifiedBlobCache = new Map<string, Uint8Array>()
let verifiedBlobCacheBytes = 0

function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key)
  if (value === undefined) return undefined
  map.delete(key)
  map.set(key, value)
  return value
}

function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function blobCacheGet(key: string): Uint8Array | undefined {
  return lruGet(verifiedBlobCache, key)
}

function blobCacheSet(key: string, value: Uint8Array): void {
  const existing = verifiedBlobCache.get(key)
  if (existing) {
    verifiedBlobCacheBytes -= existing.byteLength
    verifiedBlobCache.delete(key)
  }
  verifiedBlobCache.set(key, value)
  verifiedBlobCacheBytes += value.byteLength
  while (verifiedBlobCacheBytes > BLOB_CACHE_MAX_BYTES && verifiedBlobCache.size > 0) {
    const oldest = verifiedBlobCache.keys().next().value
    if (oldest === undefined) break
    const evicted = verifiedBlobCache.get(oldest)
    verifiedBlobCache.delete(oldest)
    if (evicted) verifiedBlobCacheBytes -= evicted.byteLength
  }
}

function stripManifestPrefix(hash: string): string {
  if (hash.startsWith('sha256:')) return hash.slice('sha256:'.length)
  return hash
}

function isRealManifestHash(hash: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(hash)
}

function looksLikeAssetPath(fileRel: string): boolean {
  return /\.[a-zA-Z0-9]{1,12}$/.test(fileRel)
}

function wantsHtmlNavigation(req: Request): boolean {
  const accept = req.headers.get('accept') || ''
  return accept.includes('text/html')
}

function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalizeJson(obj[key])
  }
  return sorted
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

function parseHostManifest(raw: unknown): HostArtifactManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as HostArtifactManifest
  if (m.version !== 1 || m.entrypoint !== 'index.html') return null
  if (!Array.isArray(m.files) || m.files.length === 0) return null
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || typeof f.hash !== 'string') return null
    if (!/^[0-9a-f]{64}$/.test(f.hash)) return null
    if (typeof f.byteSize !== 'number' || typeof f.contentType !== 'string') return null
    if (!f.path || f.path.includes('..') || f.path.startsWith('/') || f.path.includes('\\')) {
      return null
    }
  }
  return {
    version: 1,
    entrypoint: 'index.html',
    files: [...m.files].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

async function loadHostManifest(manifestHash: string): Promise<HostArtifactManifest | null> {
  if (!isRealManifestHash(manifestHash)) return null
  const cached = lruGet(manifestCache, manifestHash)
  if (cached) return cached
  const digest = stripManifestPrefix(manifestHash)
  const path = resolve(ARTIFACT_ROOT, 'manifests', `${digest}.json`)
  try {
    const st = await lstat(path)
    if (st.isSymbolicLink()) return null
    const realFile = await realpath(path)
    const realRoot = await realpath(resolve(ARTIFACT_ROOT, 'manifests'))
    if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) return null
    const raw = JSON.parse(await Bun.file(realFile).text())
    const manifest = parseHostManifest(raw)
    if (!manifest) return null
    const computed = `sha256:${createHash('sha256').update(stableStringify(manifest)).digest('hex')}`
    if (computed !== manifestHash) return null
    lruSet(manifestCache, manifestHash, manifest, MANIFEST_CACHE_MAX)
    return manifest
  } catch {
    return null
  }
}

async function resolveBlobPath(contentHash: string): Promise<string | null> {
  if (!contentHash || !/^[0-9a-f]{64}$/.test(contentHash)) return null
  const path = resolve(ARTIFACT_ROOT, 'blobs', contentHash)
  try {
    const st = await lstat(path)
    if (st.isSymbolicLink()) return null
    const realFile = await realpath(path)
    const realRoot = await realpath(resolve(ARTIFACT_ROOT, 'blobs'))
    if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) return null
    return realFile
  } catch {
    return null
  }
}

/** Verify blob bytes once, then serve from an LRU of verified content. */
async function loadVerifiedBlob(
  contentHash: string,
  expectedByteSize: number
): Promise<Uint8Array | null> {
  const cached = blobCacheGet(contentHash)
  if (cached && cached.byteLength === expectedByteSize) return cached

  const blobPath = await resolveBlobPath(contentHash)
  if (!blobPath) return null
  try {
    const buf = await readFile(blobPath)
    if (buf.byteLength !== expectedByteSize) return null
    const digest = createHash('sha256').update(buf).digest('hex')
    if (digest !== contentHash) return null
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    blobCacheSet(contentHash, bytes)
    return bytes
  } catch {
    return null
  }
}

function lookupManifestFile(
  manifest: HostArtifactManifest,
  fileRel: string
): HostArtifactManifest['files'][number] | null {
  if (!fileRel || fileRel.includes('\\') || fileRel.includes('\0')) return null
  if (fileRel.split('/').some((part) => part === '..')) return null
  return manifest.files.find((f) => f.path === fileRel) || null
}

function injectConfigIntoHtml(html: string, configScript: string): string {
  // Prefer replacing a placeholder; otherwise inject before </head> or at start of <body>.
  if (html.includes('<!--SIM_APP_CONFIG-->')) {
    return html.replace('<!--SIM_APP_CONFIG-->', configScript)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${configScript}</head>`)
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${configScript}`)
  }
  return `${configScript}${html}`
}

function cspForHtml(htmlNonce: string, frameAncestors = "'none'"): string {
  return (
    "default-src 'self'; script-src 'self' 'nonce-" +
    htmlNonce +
    "'; style-src " +
    PUBLISHED_STYLE_SRC +
    "; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors " +
    frameAncestors
  )
}

type CachedServeMeta = {
  releaseId: string
  slug: string
  htmlNonce: string
  configScript: string
  artifactManifestHash: string
  fixtureOnly: boolean
  fetchedAt: number
}

type CachedPreviewMeta = {
  artifactManifestHash: string | null
  fixtureOnly: boolean
  channelNonce: string
  htmlNonce: string
  fetchedAt: number
}

const SERVE_META_TTL_MS = 5_000
const SERVE_META_MAX_ENTRIES = 256
/** Keyed by publicId only — cosmetic slug is not part of the cache key. */
const serveMetaCache = new Map<string, CachedServeMeta>()
const previewMetaCache = new Map<string, CachedPreviewMeta>()

async function fetchServeMeta(
  publicId: string,
  slug: string,
  server: AppsHostServer,
  bypassCache = false
): Promise<CachedServeMeta | { status: number } | null> {
  if (!bypassCache) {
    const cached = ttlLruGet(serveMetaCache, publicId, SERVE_META_TTL_MS)
    if (cached) return cached
  }

  const metaReq = new Request(
    `${PUBLIC_ORIGIN}/api/apps/public/${publicId}/serve-meta?slug=${encodeURIComponent(slug)}`,
    { method: 'GET', headers: { accept: 'application/json' } }
  )
  const metaRes = await proxyToSim(metaReq, `/api/apps/public/${publicId}/serve-meta`, server)
  if (metaRes.status === 410 || metaRes.status === 404) {
    serveMetaCache.delete(publicId)
    return { status: metaRes.status }
  }
  if (!metaRes.ok) return null

  const meta = (await metaRes.json()) as {
    data?: CachedServeMeta & { artifactRoot?: string }
    releaseId?: string
    slug?: string
    htmlNonce?: string
    configScript?: string
    artifactManifestHash?: string
    artifactRoot?: string
    fixtureOnly?: boolean
  }
  const payload = meta.data || meta
  const artifactManifestHash = payload.artifactManifestHash || payload.artifactRoot
  if (
    !payload.releaseId ||
    !payload.slug ||
    !payload.htmlNonce ||
    !payload.configScript ||
    !artifactManifestHash
  ) {
    return null
  }

  const entry: CachedServeMeta = {
    releaseId: payload.releaseId,
    slug: payload.slug,
    htmlNonce: payload.htmlNonce,
    configScript: payload.configScript,
    artifactManifestHash,
    fixtureOnly: Boolean(payload.fixtureOnly),
    fetchedAt: Date.now(),
  }
  ttlLruSet(serveMetaCache, publicId, entry, SERVE_META_MAX_ENTRIES)
  return entry
}

async function fetchPreviewMeta(
  sessionId: string,
  channelNonce: string,
  server: AppsHostServer
): Promise<CachedPreviewMeta | { status: number } | null> {
  const cacheKey = `${sessionId}:${channelNonce}`
  const cached = ttlLruGet(previewMetaCache, cacheKey, SERVE_META_TTL_MS)
  if (cached) return cached

  const metaReq = new Request(
    `${PUBLIC_ORIGIN}/api/apps/public/preview/${encodeURIComponent(sessionId)}/serve-meta?nonce=${encodeURIComponent(channelNonce)}`,
    { method: 'GET', headers: { accept: 'application/json' } }
  )
  const metaRes = await proxyToSim(
    metaReq,
    `/api/apps/public/preview/${encodeURIComponent(sessionId)}/serve-meta`,
    server
  )
  if (metaRes.status === 410 || metaRes.status === 404) return { status: metaRes.status }
  if (!metaRes.ok) return null

  const meta = (await metaRes.json()) as {
    data?: {
      artifactManifestHash?: string | null
      fixtureOnly?: boolean
      channelNonce?: string
      htmlNonce?: string
    }
    artifactManifestHash?: string | null
    fixtureOnly?: boolean
    channelNonce?: string
    htmlNonce?: string
  }
  const payload = meta.data || meta
  if (!payload.channelNonce || !payload.htmlNonce || payload.channelNonce !== channelNonce) {
    return null
  }

  const entry: CachedPreviewMeta = {
    artifactManifestHash: payload.artifactManifestHash?.startsWith('sha256:')
      ? payload.artifactManifestHash
      : null,
    fixtureOnly:
      Boolean(payload.fixtureOnly) || !payload.artifactManifestHash?.startsWith('sha256:'),
    channelNonce: payload.channelNonce,
    htmlNonce: payload.htmlNonce,
    fetchedAt: Date.now(),
  }
  ttlLruSet(previewMetaCache, cacheKey, entry, SERVE_META_MAX_ENTRIES)
  return entry
}

/**
 * Session-bound diagnostic shell for fixture previews (and hardened legacy route).
 * Uses CSP nonce + safeJsonForScript — never interpolates raw query strings.
 */
function previewShellHtml(params: {
  channelNonce: string
  parentOrigin: string
  htmlNonce: string
}): { html: string; csp: string } {
  const parentOrigin = normalizePreviewParentOrigin(params.parentOrigin)
  if (!parentOrigin) {
    throw new Error('invalid parentOrigin')
  }
  const bootstrap = safeJsonForScript({
    channelNonce: params.channelNonce,
    parentOrigin,
  })
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preview bridge</title>
<style>body{font-family:system-ui;margin:0;background:#0b0d10;color:#e8eaed;padding:24px}button{cursor:pointer;padding:.5rem 1rem}pre{white-space:pre-wrap}</style>
</head>
<body>
<main>
  <h1>Preview bridge (diagnostic)</h1>
  <p style="opacity:.7;font-size:14px">Action bridge only — not the generated React UI.</p>
  <button type="button" id="run">Run main</button>
  <pre id="out"></pre>
</main>
<script nonce="${params.htmlNonce}">
(function () {
  var cfg = ${bootstrap};
  var channelNonce = cfg.channelNonce;
  var parentOrigin = cfg.parentOrigin;
  function run(actionId, input) {
    return new Promise(function (resolve) {
      var requestId = crypto.randomUUID();
      function onMessage(event) {
        if (event.origin !== parentOrigin) return;
        var data = event.data;
        if (!data || data.type !== 'sim.run.result' || data.requestId !== requestId) return;
        if (data.nonce !== channelNonce) return;
        window.removeEventListener('message', onMessage);
        resolve(data.result);
      }
      window.addEventListener('message', onMessage);
      parent.postMessage({
        type: 'sim.run',
        actionId: actionId,
        input: input || {},
        requestId: requestId,
        nonce: channelNonce
      }, parentOrigin);
    });
  }
  document.getElementById('run').onclick = async function () {
    var out = document.getElementById('out');
    out.textContent = 'Running…';
    try {
      var result = await run('main', {});
      out.textContent = JSON.stringify(result, null, 2);
    } catch (e) {
      out.textContent = e && e.message ? e.message : String(e);
    }
  };
})();
</script>
</body>
</html>`
  const csp =
    "default-src 'none'; script-src 'nonce-" +
    params.htmlNonce +
    "'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors " +
    parentOrigin
  return { html, csp }
}

async function serveManifestAsset(params: {
  req: Request
  artifactManifestHash: string
  fileRel: string
  htmlInjector: (html: string) => string
  htmlCsp: string
  htmlCacheControl: string
}): Promise<Response> {
  const manifest = await loadHostManifest(params.artifactManifestHash)
  if (!manifest) {
    return new Response(TOMBSTONE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  let fileRel = params.fileRel || 'index.html'
  let entry = lookupManifestFile(manifest, fileRel)
  if (!entry && !looksLikeAssetPath(fileRel) && wantsHtmlNavigation(params.req)) {
    entry = lookupManifestFile(manifest, 'index.html')
    fileRel = 'index.html'
  }
  if (!entry) {
    return new Response('Not found', { status: 404 })
  }

  const bytes = await loadVerifiedBlob(entry.hash, entry.byteSize)
  if (!bytes) {
    return new Response(TOMBSTONE_HTML, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  const isHtml = fileRel.endsWith('.html') || entry.contentType.startsWith('text/html')
  if (isHtml) {
    let html = new TextDecoder('utf-8').decode(bytes)
    html = params.htmlInjector(html)
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': params.htmlCacheControl,
        'content-security-policy': params.htmlCsp,
      },
    })
  }

  if (params.req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': entry.contentType || contentTypeFor(fileRel),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(entry.byteSize),
      },
    })
  }

  const body = Uint8Array.from(bytes)
  return new Response(body, {
    headers: {
      'content-type': entry.contentType || contentTypeFor(fileRel),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}

async function serveArtifact(
  req: Request,
  publicId: string,
  slug: string,
  assetPath: string,
  server: AppsHostServer
): Promise<Response> {
  const meta = await fetchServeMeta(
    publicId,
    slug,
    server,
    isPublishedDocumentRequest(assetPath, req.headers.get('accept') || '')
  )

  if (meta && 'status' in meta) {
    return new Response(TOMBSTONE_HTML, {
      status: 410,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    })
  }

  if (!meta) {
    return new Response(TOMBSTONE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const {
    releaseId,
    slug: canonicalSlug,
    htmlNonce,
    configScript,
    artifactManifestHash,
    fixtureOnly,
  } = meta

  if (slug !== canonicalSlug) {
    const suffix = assetPath ? `/${assetPath}` : ''
    return Response.redirect(`${PUBLIC_ORIGIN}/a/${publicId}/${canonicalSlug}${suffix}`, 301)
  }

  let fileRel = assetPath || 'index.html'

  const serveFixtureHtml = async (): Promise<Response | null> => {
    const htmlReq = new Request(
      `${PUBLIC_ORIGIN}/api/apps/public/${publicId}/releases/${releaseId}/html?nonce=${encodeURIComponent(htmlNonce)}`,
      { method: 'GET' }
    )
    const htmlRes = await proxyToSim(
      htmlReq,
      `/api/apps/public/${publicId}/releases/${releaseId}/html`,
      server
    )
    if (!htmlRes.ok) return null
    let html = await htmlRes.text()
    if (!html.includes('__SIM_APP_CONFIG') && !html.includes(configScript)) {
      html = injectConfigIntoHtml(html, configScript)
    }
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
        'content-security-policy': cspForHtml(htmlNonce),
      },
    })
  }

  // Fixture builds have no verified artifact manifest — never serve disk blobs.
  if (fixtureOnly || artifactManifestHash.startsWith('fixture:')) {
    if (looksLikeAssetPath(fileRel) && fileRel !== 'index.html') {
      return new Response('Not found', { status: 404 })
    }
    fileRel = 'index.html'
    const html = await serveFixtureHtml()
    if (html) return html
    return new Response('Not found', { status: 404 })
  }

  return serveManifestAsset({
    req,
    artifactManifestHash,
    fileRel,
    htmlInjector: (html) => injectConfigIntoHtml(html, configScript),
    htmlCsp: cspForHtml(htmlNonce),
    htmlCacheControl: 'public, max-age=60',
  })
}

async function servePreviewArtifact(
  req: Request,
  sessionId: string,
  channelNonce: string,
  assetPath: string,
  server: AppsHostServer
): Promise<Response> {
  const url = new URL(req.url)
  const rawParent = url.searchParams.get('parentOrigin') || ''
  const parentOrigin = normalizePreviewParentOrigin(rawParent)
  const fileRel = assetPath || 'index.html'
  const isDocument =
    fileRel === 'index.html' || (!looksLikeAssetPath(fileRel) && wantsHtmlNavigation(req))

  if (isDocument) {
    if (!parentOrigin) {
      return new Response('parentOrigin required', { status: 400 })
    }
    if (!isAllowedPreviewParentOrigin(parentOrigin)) {
      return new Response('parentOrigin is not an allowed Sim origin', { status: 400 })
    }
  }

  const meta = await fetchPreviewMeta(sessionId, channelNonce, server)
  if (meta && 'status' in meta) {
    return new Response(TOMBSTONE_HTML, {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  if (!meta) {
    return new Response(TOMBSTONE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  // Fixture / diagnostic: session-bound shell (no free-standing query injection surface).
  if (meta.fixtureOnly || !meta.artifactManifestHash) {
    if (looksLikeAssetPath(fileRel) && fileRel !== 'index.html') {
      return new Response('Not found', { status: 404 })
    }
    if (!parentOrigin) {
      return new Response('parentOrigin required', { status: 400 })
    }
    try {
      const shell = previewShellHtml({
        channelNonce: meta.channelNonce,
        parentOrigin,
        htmlNonce: meta.htmlNonce,
      })
      return new Response(shell.html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': shell.csp,
        },
      })
    } catch {
      return new Response('Invalid parentOrigin', { status: 400 })
    }
  }

  const previewScript = parentOrigin
    ? `<script nonce="${meta.htmlNonce}">window.__SIM_PREVIEW__=${safeJsonForScript({
        channelNonce: meta.channelNonce,
        parentOrigin,
      })};</script>`
    : ''

  return serveManifestAsset({
    req,
    artifactManifestHash: meta.artifactManifestHash,
    fileRel,
    htmlInjector: (html) => (previewScript ? injectConfigIntoHtml(html, previewScript) : html),
    htmlCsp: cspForHtml(meta.htmlNonce, parentOrigin || "'none'"),
    htmlCacheControl: 'no-store',
  })
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    if (pathname === '/health') {
      return Response.json({ ok: true, service: 'apps-host' })
    }

    if (pathname === '/__fixture__/sim-app-sdk.js' && req.method === 'GET') {
      return new Response(FIXTURE_SDK_JS, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }

    // /__sim/preview/{sessionId}/{channelNonce}/[asset...]
    const previewArtifactMatch = pathname.match(/^\/__sim\/preview\/([^/]+)\/([^/]+)(?:\/(.*))?$/)
    if (previewArtifactMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const channelNonce = previewArtifactMatch[2]
      if (!isValidPreviewChannelNonce(channelNonce)) {
        return new Response('Invalid preview capability', { status: 400 })
      }
      const response = await servePreviewArtifact(
        req,
        previewArtifactMatch[1],
        channelNonce,
        previewArtifactMatch[3] || '',
        server
      )
      if (req.method === 'HEAD') {
        return new Response(null, { status: response.status, headers: response.headers })
      }
      return response
    }

    // Free-standing diagnostic shell removed — use session-bound /__sim/preview/...
    if (pathname === '/__sim/preview-shell') {
      return new Response('Gone — use /__sim/preview/{sessionId}/{channelNonce}/', {
        status: 410,
        headers: { 'cache-control': 'no-store' },
      })
    }

    const actionMatch = pathname.match(/^\/__sim\/actions\/releases\/([^/]+)\/actions\/([^/]+)$/)
    if (actionMatch && (req.method === 'POST' || req.method === 'HEAD')) {
      if (req.method === 'HEAD') {
        return new Response(null, { status: 200 })
      }
      const simPath = `/api/apps/gateway/releases/${actionMatch[1]}/actions/${actionMatch[2]}`
      return proxyToSim(req, simPath, server)
    }

    if (pathname === '/__sim/abuse/session' && req.method === 'POST') {
      return proxyToSim(req, '/api/apps/gateway/abuse/session', server)
    }

    const appMatch = pathname.match(/^\/a\/([^/]+)\/([^/]+)(?:\/(.*))?$/)
    if (appMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      // Vite emits relative asset URLs. Canonicalize the app document to a
      // directory URL so "./assets/..." stays under /a/{publicId}/{slug}/.
      const directoryRedirect = appDirectoryRedirect(
        PUBLIC_ORIGIN,
        pathname,
        url.search,
        appMatch[3]
      )
      if (directoryRedirect) return Response.redirect(directoryRedirect, 308)
      const response = await serveArtifact(req, appMatch[1], appMatch[2], appMatch[3] || '', server)
      if (req.method === 'HEAD') {
        return new Response(null, { status: response.status, headers: response.headers })
      }
      return response
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(
  `apps-host listening on http://localhost:${server.port} → Sim ${SIM_URL} (artifacts ${ARTIFACT_ROOT})`
)
