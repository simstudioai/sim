import { db } from '@sim/db'
import { workspaceSandbox } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  MAX_SANDBOX_DEPENDENCIES,
  parseJsDependency,
  registryFor,
  type SandboxLanguage,
} from '@/lib/execution/remote-sandbox/sandbox-spec'

const logger = createLogger('SandboxWandEnricher')

/** Registry lookups are a nice-to-have; a slow one must never delay generation. */
const REGISTRY_TIMEOUT_MS = 2_000

/**
 * Package metadata barely changes, so a process-lifetime cache is enough — but it
 * is keyed by an unbounded space (every package any workspace ever declares), so
 * it evicts oldest-first rather than growing forever.
 */
const METADATA_CACHE_LIMIT = 500
const metadataCache = new Map<string, PackageMetadata | null>()

function rememberMetadata(key: string, metadata: PackageMetadata | null): void {
  if (metadataCache.size >= METADATA_CACHE_LIMIT) {
    const oldest = metadataCache.keys().next()
    if (!oldest.done) metadataCache.delete(oldest.value)
  }
  metadataCache.set(key, metadata)
}

interface PackageMetadata {
  name: string
  version?: string
  summary?: string
}

/** Strips the version specifier, leaving the bare distribution/package name. */
function bareName(language: SandboxLanguage, dependency: string): string {
  if (language === CodeLanguage.Python) {
    const boundary = dependency.search(/[[<>=!~]/)
    return boundary === -1 ? dependency : dependency.slice(0, boundary)
  }
  return parseJsDependency(dependency).name
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  // boundary-raw-fetch: external-origin request to a public package registry
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) return null
  return response.json()
}

/**
 * Fetches name, resolved version, and one-line summary from the public registry.
 *
 * `/api/wand` is a single-shot completion with no tools, so live documentation
 * retrieval is not available. This grounds *which* library and *which* version
 * without an LLM tool loop. Any failure returns null and the caller degrades to
 * the bare name — a registry hiccup must not fail the generation.
 */
async function fetchPackageMetadata(
  language: SandboxLanguage,
  name: string,
  signal: AbortSignal
): Promise<PackageMetadata | null> {
  const cacheKey = `${language}:${name}`
  const cached = metadataCache.get(cacheKey)
  if (cached !== undefined) return cached

  let metadata: PackageMetadata | null = null
  try {
    if (language === CodeLanguage.Python) {
      const body = (await fetchJson(
        `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
        signal
      )) as { info?: { name?: string; version?: string; summary?: string } } | null
      if (body?.info) {
        metadata = {
          name: body.info.name ?? name,
          version: body.info.version,
          summary: body.info.summary ?? undefined,
        }
      }
    } else {
      // `/latest` rather than the full packument: the root document carries every
      // published version's manifest and runs to megabytes for a popular package,
      // which would blow the timeout budget below just to read three fields.
      const body = (await fetchJson(
        `https://registry.npmjs.org/${name.split('/').map(encodeURIComponent).join('/')}/latest`,
        signal
      )) as { name?: string; version?: string; description?: string } | null
      if (body?.name) {
        metadata = {
          name: body.name,
          version: body.version,
          summary: body.description ?? undefined,
        }
      }
    }
  } catch (error) {
    logger.warn('Package registry lookup failed', { name, error })
  }

  // Only successes are cached. A miss here is usually the shared abort deadline
  // below firing, and caching that would permanently degrade the prompt for a
  // package that is perfectly resolvable on the next attempt.
  if (metadata) rememberMetadata(cacheKey, metadata)
  return metadata
}

function describe(dependency: string, metadata: PackageMetadata | null): string {
  if (!metadata) return `- ${dependency}`
  const version = metadata.version ? ` (latest ${metadata.version})` : ''
  const summary = metadata.summary ? ` — ${metadata.summary}` : ''
  return `- ${dependency}${version}${summary}`
}

/**
 * Wand enricher that tells the model which packages the block can actually
 * import. With no sandbox selected it returns null, leaving today's prompt
 * unchanged.
 */
export async function enrichSandboxPackages(
  workspaceId: string | null,
  context: Record<string, unknown>
): Promise<string | null> {
  const sandboxId = context.sandboxId as string | undefined
  if (!sandboxId || !workspaceId) return null

  const [sandbox] = await db
    .select({
      name: workspaceSandbox.name,
      language: workspaceSandbox.language,
      dependencies: workspaceSandbox.dependencies,
    })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  if (!sandbox) return null
  const language = sandbox.language as SandboxLanguage
  const dependencies = (sandbox.dependencies ?? []).slice(0, MAX_SANDBOX_DEPENDENCIES)
  if (dependencies.length === 0) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)
  let metadata: (PackageMetadata | null)[]
  try {
    metadata = await Promise.all(
      dependencies.map((dependency) =>
        fetchPackageMetadata(language, bareName(language, dependency), controller.signal).catch(
          () => null
        )
      )
    )
  } finally {
    clearTimeout(timer)
  }

  const registry = registryFor(language)
  const lines = dependencies.map((dependency, index) => describe(dependency, metadata[index]))
  return [
    `This block runs in the "${sandbox.name}" sandbox, which has these ${registry} packages installed:`,
    ...lines,
    'You may import any of them. Do NOT import a package that is not on this list — it is not installed and the code will fail.',
  ].join('\n')
}
