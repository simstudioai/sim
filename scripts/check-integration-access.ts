#!/usr/bin/env bun
/**
 * Keeps every surface that lists integrations on `useIntegrationAccess`.
 *
 * The integration catalogs are plain module exports, so a new picker that maps
 * over one starts with every integration and is correct only if its author
 * remembers to filter. A missed filter lists integrations the viewer's
 * permission group denies, or whose OAuth the deployment never configured, and
 * the server silently drops any mention of one. `useIntegrationAccess` is the
 * one verdict those surfaces share; this audit makes reaching a raw catalog
 * without it a build failure.
 *
 * The rule: a scanned module that reads a raw catalog must also call
 * `useIntegrationAccess`, or appear in {@link EXEMPT} with the reason it may see
 * every integration (a lookup by id, a public page, a builder whose caller
 * gates). An exemption that no longer covers a raw import is reported too, so
 * the list cannot outlive its reason. `useIntegrationAccessPolicy`, which fails
 * open while the policy loads, is refused outside {@link FAIL_OPEN_READER}, so
 * no listing can reach around the gate through it.
 *
 * Scope: client-facing modules under {@link SCAN_ROOTS}, minus API routes,
 * `*.server.ts` and tests. `lib/` and `blocks/` are not scanned: they define
 * and derive the catalogs, and no module there renders a list to a viewer.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegExp } from '@sim/utils/string'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/sim')
const SCAN_ROOTS = ['app', 'components', 'hooks', 'stores', 'ee'] as const
const GATE_MODULE = '@/hooks/use-integration-access'
const GATE_NAME = 'useIntegrationAccess'
const FAIL_OPEN_NAME = 'useIntegrationAccessPolicy'
/** The one module allowed the fail-open policy, for the gates that have always failed open. */
const FAIL_OPEN_READER = 'hooks/use-permission-config.ts'

/** Each module that exports a whole integration catalog, and the exports that are one. */
const RAW_CATALOGS: Readonly<Record<string, readonly string[]>> = {
  '@/lib/integrations': ['INTEGRATIONS'],
  '@/blocks/integration-matcher': ['listIntegrations', 'listIntegrationsByPopularity'],
  '@sim/deployment-config/integration-metadata': ['INTEGRATION_METADATA'],
}

/** Modules, or directories ending in `/`, allowed every integration, relative to `apps/sim`. */
const EXEMPT: Readonly<Record<string, string>> = {
  'app/(landing)/': 'public marketing site: lists the catalog to visitors, who have no policy',
  'app/sitemap.ts': 'public sitemap of the marketing integration pages',
  'app/workspace/[workspaceId]/integrations/[block]/page.tsx':
    'resolves the route slug to one integration; IntegrationBlockDetail gates it',
  'app/workspace/[workspaceId]/home/components/suggested-actions/suggested-actions.tsx':
    'maps integration names to slugs to rewrite prompt text; lists nothing',
  'app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/integration-search-items.ts':
    'builder whose required `isUsable` the sidebar supplies from useIntegrationAccess',
  'ee/credential-groups/components/credential-group-provider-tile.tsx':
    'looks up one integration by type for its tile',
}

interface SourceFile {
  /** Relative to `apps/sim`, `/`-separated. */
  path: string
  source: string
}

interface IntegrationAccessViolation {
  path: string
  /** The raw catalog exports, or the fail-open policy, read without leave; empty for a stale exemption. */
  names: string[]
  stale: boolean
}

const NAMED_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]/g

/** One export of a module, and the expression the importing module reaches it through. */
interface ExportReference {
  exported: string
  /**
   * The local binding, or `namespace.member` for a member read; absent when a
   * namespace escapes member access, where the read cannot be traced.
   */
  local?: string
}

/**
 * The exports of `from` a module reaches as values, through named or namespace
 * imports. A namespace used other than as `namespace.member` — destructured,
 * indexed, or passed along — is taken to read every one of `exports`, so an
 * untraceable read is never mistaken for none.
 */
function exportReferences(
  source: string,
  from: string,
  exports: readonly string[]
): ExportReference[] {
  const references: ExportReference[] = []
  for (const [, typeOnly, specifiers, module] of source.matchAll(NAMED_IMPORT)) {
    if (module !== from || typeOnly) continue
    for (const specifier of specifiers.split(',')) {
      const [exported, local = exported] = specifier.trim().split(/\s+as\s+/)
      if (exported && !exported.startsWith('type ')) references.push({ exported, local })
    }
  }
  for (const [declaration, namespace, module] of source.matchAll(NAMESPACE_IMPORT)) {
    if (module !== from) continue
    const binding = `(?<![\\w$.])${escapeRegExp(namespace)}(?![\\w$])`
    for (const [local, exported] of source.matchAll(new RegExp(`${binding}\\.([\\w$]+)`, 'g'))) {
      references.push({ exported, local })
    }
    const body = source.replace(declaration, '')
    if (new RegExp(`${binding}(?!\\s*\\.[\\w$])`).test(body)) {
      references.push(...exports.map((exported) => ({ exported })))
    }
  }
  return references
}

function isCalled(source: string, local: string | undefined): boolean {
  if (local === undefined) return false
  return new RegExp(`(?<![\\w$.])${escapeRegExp(local)}\\s*\\(`).test(source)
}

/** The raw catalog exports a module reads. */
function rawCatalogReads(source: string): string[] {
  const names = new Set<string>()
  for (const [module, catalog] of Object.entries(RAW_CATALOGS)) {
    for (const { exported } of exportReferences(source, module, catalog)) {
      if (catalog.includes(exported)) names.add(exported)
    }
  }
  return [...names]
}

function exemptionFor(path: string, exempt: Readonly<Record<string, string>>): string | undefined {
  return Object.keys(exempt).find((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry
  )
}

export function findIntegrationAccessViolations(
  files: readonly SourceFile[],
  exempt: Readonly<Record<string, string>>
): IntegrationAccessViolation[] {
  const violations: IntegrationAccessViolation[] = []
  const usedExemptions = new Set<string>()
  for (const { path, source } of files) {
    const gateReferences = exportReferences(source, GATE_MODULE, [GATE_NAME, FAIL_OPEN_NAME])
    const readsFailOpen = gateReferences.some(({ exported }) => exported === FAIL_OPEN_NAME)
    if (readsFailOpen && path !== FAIL_OPEN_READER) {
      violations.push({ path, names: [FAIL_OPEN_NAME], stale: false })
    }
    const names = rawCatalogReads(source)
    if (names.length === 0) continue
    const exemption = exemptionFor(path, exempt)
    if (exemption) {
      usedExemptions.add(exemption)
      continue
    }
    const callsGate = gateReferences.some(
      ({ exported, local }) => exported === GATE_NAME && isCalled(source, local)
    )
    if (!callsGate) violations.push({ path, names, stale: false })
  }
  for (const entry of Object.keys(exempt)) {
    if (!usedExemptions.has(entry)) violations.push({ path: entry, names: [], stale: true })
  }
  return violations
}

function isScanned(path: string): boolean {
  return (
    /\.tsx?$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !path.endsWith('.server.ts') &&
    !path.startsWith('app/api/')
  )
}

function collectSources(): SourceFile[] {
  return SCAN_ROOTS.flatMap((root) =>
    readdirSync(join(APP_ROOT, root), { recursive: true, encoding: 'utf8' })
      .map((entry) =>
        relative(APP_ROOT, join(APP_ROOT, root, entry))
          .split('\\')
          .join('/')
      )
      .filter(isScanned)
      .map((path) => ({ path, source: readFileSync(join(APP_ROOT, path), 'utf8') }))
  )
}

function main() {
  const violations = findIntegrationAccessViolations(collectSources(), EXEMPT)
  if (violations.length === 0) {
    console.log('✓ every integration listing calls useIntegrationAccess')
    return
  }
  for (const violation of violations) {
    if (violation.stale) {
      console.error(
        `✗ ${violation.path}: exempt in check-integration-access.ts but reads no raw catalog — remove the entry`
      )
    } else if (violation.names.includes(FAIL_OPEN_NAME)) {
      console.error(
        `✗ apps/sim/${violation.path}: reads ${FAIL_OPEN_NAME}, which fails open while loading — only ${FAIL_OPEN_READER} may`
      )
    } else {
      console.error(
        `✗ apps/sim/${violation.path}: reads ${violation.names.join(', ')} without calling ${GATE_NAME}`
      )
    }
  }
  console.error(
    `\nList integrations through ${GATE_NAME} (${GATE_MODULE}), which fails closed until the viewer's policy loads. A module that may see every integration belongs in EXEMPT with its reason.`
  )
  process.exit(1)
}

if (import.meta.main) main()
