import { pathToFileURL } from 'node:url'
import { generateSimGeneratedTs } from '@/lib/apps/build/generate-sdk'
import {
  CURATED_BARE_IMPORTS,
  PLATFORM_OWNED_PATHS,
} from '@/lib/apps/build/prepare-source-allowlist'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import {
  APP_SDK_VERSION,
  APP_TEMPLATE_FILES,
  APP_TEMPLATE_VERSION,
} from '@/lib/apps/template/versions'

export { CURATED_BARE_IMPORTS, PLATFORM_OWNED_PATHS }

export function isAllowedUserPath(path: string): boolean {
  if (PLATFORM_OWNED_PATHS.has(path)) return false
  if (path.includes('..') || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    return false
  }
  if (path.startsWith('node_modules/') || path.startsWith('.env') || path === '.env') return false
  if (path.startsWith('src/')) {
    return /\.(tsx?|jsx?|css|json)$/.test(path)
  }
  if (path.startsWith('public/')) {
    return !path.includes('..')
  }
  return false
}

/** True when a revision path is ignored/overwritten by the platform (not an error). */
export function isPlatformOwnedOrSkippedPath(path: string): boolean {
  return PLATFORM_OWNED_PATHS.has(path)
}

/**
 * Platform Vite config — absolute file: imports for vite/plugin so the work root
 * needs no node_modules symlink (avoids host cache writes through a symlink).
 *
 * Import plugins are guardrails for ESM resolves. Rolldown/Vite may still pull
 * transitive CJS deps (e.g. scheduler) via native resolution; local-vite artifacts
 * remain unpublishable in production. E2B is the real sandbox boundary.
 */
export function platformViteConfig(params: {
  projectRoot: string
  appSdkEntry: string
  appSdkDir: string
  reactDir: string
  reactDomDir: string
  schedulerDir: string
  viteEntry: string
  viteReactPlugin: string
}): string {
  const allowlist = JSON.stringify([...CURATED_BARE_IMPORTS])
  const viteUrl = pathToFileURL(params.viteEntry).href
  const pluginUrl = pathToFileURL(params.viteReactPlugin).href
  return `import { defineConfig } from ${JSON.stringify(viteUrl)}
import react from ${JSON.stringify(pluginUrl)}
import { dirname, resolve, sep } from 'node:path'

const ALLOWED_BARE = new Set(${allowlist})
const PROJECT_ROOT = ${JSON.stringify(params.projectRoot)}
const CURATED_PACKAGE_ROOTS = [
  ${JSON.stringify(params.appSdkDir)},
  ${JSON.stringify(params.reactDir)},
  ${JSON.stringify(params.reactDomDir)},
  ${JSON.stringify(params.schedulerDir)},
]

function stripQuery(id) {
  const hash = id.indexOf('#')
  const withoutHash = hash >= 0 ? id.slice(0, hash) : id
  const q = withoutHash.indexOf('?')
  return q >= 0 ? withoutHash.slice(0, q) : withoutHash
}

function pathIsInsideRoot(absolutePath, root) {
  // Normalize /var vs /private/var (macOS tmp) so containment checks don't false-negative.
  const normalized = resolve(absolutePath).replace(/^\\/private\\/var\\//, '/var/')
  const normalizedRoot = resolve(root).replace(/^\\/private\\/var\\//, '/var/')
  return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + sep)
}

function curatedNodeModulePackage(file) {
  const parts = resolve(file).split(sep)
  const nm = parts.lastIndexOf('node_modules')
  if (nm < 0 || nm + 1 >= parts.length) return null
  if (parts[nm + 1].startsWith('@')) {
    if (nm + 2 >= parts.length) return null
    return parts[nm + 1] + '/' + parts[nm + 2]
  }
  return parts[nm + 1]
}

function assertResolvedAllowed(resolvedId, sourceId) {
  const file = stripQuery(resolvedId)
  if (!file || file.startsWith('\\0')) return null
  // Curated React/SDK roots (realpath-safe: match package name under node_modules).
  if (CURATED_PACKAGE_ROOTS.some((root) => pathIsInsideRoot(file, root))) return null
  const nmPkg = curatedNodeModulePackage(file)
  if (nmPkg === 'react' || nmPkg === 'react-dom' || nmPkg === 'scheduler') return null
  // Vendor SDK copied into the work tree.
  if (pathIsInsideRoot(file, ${JSON.stringify(params.appSdkDir)})) return null
  // Vite injects this client helper during HTML builds.
  if (sourceId === 'vite/modulepreload-polyfill') return null
  if (file.includes(sep + 'vite' + sep + 'dist' + sep + 'client')) return null
  // Project files OK, but never a work-root node_modules tree.
  if (pathIsInsideRoot(file, PROJECT_ROOT)) {
    if (file.includes(sep + 'node_modules' + sep) || file.endsWith(sep + 'node_modules')) {
      return 'Import escapes build sandbox (node_modules): ' + sourceId
    }
    return null
  }
  return 'Import escapes build sandbox: ' + sourceId
}

function curatedImportPlugin() {
  return {
    name: 'sim-curated-imports',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id || id.startsWith('\\0')) return null

      const bareId = stripQuery(id)
      const isRelative = bareId.startsWith('.')
      const isAbsolute = bareId.startsWith('/') || /^[A-Za-z]:[\\\\/]/.test(bareId)

      if (isRelative || isAbsolute) {
        // Vite root-absolute ("/src/...") is project-relative, not FS-absolute.
        const candidate =
          bareId.startsWith('/') && !bareId.startsWith('//') && !/^[A-Za-z]:[\\\\/]/.test(bareId)
            ? resolve(PROJECT_ROOT, bareId.slice(1))
            : resolve(importer ? dirname(stripQuery(importer)) : PROJECT_ROOT, bareId)
        const err = assertResolvedAllowed(candidate, id)
        if (err) return this.error(err)
        return null
      }

      if (bareId.startsWith('node:')) {
        return this.error('Disallowed import "' + bareId + '" — curated app deps only')
      }
      if (bareId === 'vite/modulepreload-polyfill') return null
      if (ALLOWED_BARE.has(bareId)) return null
      const root = bareId.startsWith('@')
        ? bareId.split('/').slice(0, 2).join('/')
        : bareId.split('/')[0]
      if (ALLOWED_BARE.has(root)) return null
      return this.error(
        'Disallowed import "' + bareId + '". Local app builds may only import: ' + [...ALLOWED_BARE].join(', ')
      )
    },
  }
}

function containmentPlugin() {
  return {
    name: 'sim-import-containment',
    enforce: 'post',
    async resolveId(id, importer, options) {
      if (!id || id.startsWith('\\0')) return null
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.id.startsWith('\\0')) return resolved
      const err = assertResolvedAllowed(resolved.id, id)
      if (err) return this.error(err)
      return resolved
    },
  }
}

export default defineConfig({
  // cwd is the work root — do not set root to an absolute path (Vite 8/Rolldown
  // then emits absolute HTML asset names and fails the build).
  base: './',
  cacheDir: resolve(PROJECT_ROOT, '.vite'),
  plugins: [curatedImportPlugin(), containmentPlugin(), react()],
  resolve: {
    alias: {
      '@sim/app-sdk': ${JSON.stringify(params.appSdkEntry)},
      react: ${JSON.stringify(params.reactDir)},
      'react-dom': ${JSON.stringify(params.reactDomDir)},
      scheduler: ${JSON.stringify(params.schedulerDir)},
      'react/jsx-runtime': resolve(${JSON.stringify(params.reactDir)}, 'jsx-runtime.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
  },
})
`
}

export const PLATFORM_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      isolatedModules: true,
      resolveJsonModule: true,
      esModuleInterop: true,
    },
    include: ['src'],
  },
  null,
  2
)

/**
 * Merge revision files with platform-owned template + generated SDK.
 * Unsupported revision paths are rejected (not silently skipped) so the
 * revision hash cannot claim content the build never used.
 */
export function prepareTrustedSourceTree(params: {
  revisionFiles: Record<string, string>
  actions: AppActionManifestEntry[]
}): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = { ...APP_TEMPLATE_FILES }

  for (const [path, content] of Object.entries(params.revisionFiles)) {
    if (PLATFORM_OWNED_PATHS.has(path)) continue
    if (!isAllowedUserPath(path)) {
      return {
        ok: false,
        error: `Unsupported revision path (not used in build): ${path}. Only src/** and public/** user files are allowed.`,
      }
    }
    out[path] = content
  }

  out['tsconfig.json'] = PLATFORM_TSCONFIG
  out['index.html'] = APP_TEMPLATE_FILES['index.html']
  out['package.json'] = APP_TEMPLATE_FILES['package.json']
  out['src/sim.generated.ts'] = generateSimGeneratedTs(params.actions)

  return { ok: true, files: out }
}

export { APP_TEMPLATE_VERSION, APP_SDK_VERSION }
