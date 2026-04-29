#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const API_DIR = path.join(ROOT, 'apps/sim/app/api')
const QUERY_HOOKS_DIR = path.join(ROOT, 'apps/sim/hooks/queries')

const BASELINE = {
  totalRoutes: 711,
  zodRoutes: 711,
  nonZodRoutes: 0,
} as const

const BOUNDARY_POLICY_BASELINE = {
  routeZodImports: 2,
  routeLocalSchemaRoutes: 2,
  routeLocalSchemaConstructors: 6,
  routeZodErrorReferences: 0,
  clientHookZodImports: 0,
  clientHookLocalSchemaFiles: 0,
  clientHookLocalSchemaConstructors: 0,
} as const

const INDIRECT_ZOD_ROUTES = new Set([
  'apps/sim/app/api/contact/route.ts',
  'apps/sim/app/api/demo-requests/route.ts',
  'apps/sim/app/api/logs/export/route.ts',
  'apps/sim/app/api/tools/docusign/route.ts',
  // Better Auth handles its own validation for the catch-all route below.
  'apps/sim/app/api/auth/[...all]/route.ts',
  // Better Auth handles validation for the Stripe webhook handler.
  'apps/sim/app/api/auth/webhook/stripe/route.ts',
  // Routes with no client-supplied input that previously had no-op
  // `z.object({}).strict().parse({})` guards. The boundary contract for
  // these routes is "no input", and they consume validated data only via
  // session/headers handled by `getSession()` / Better Auth.
  'apps/sim/app/api/auth/oauth/connections/route.ts',
  'apps/sim/app/api/auth/providers/route.ts',
  'apps/sim/app/api/auth/socket-token/route.ts',
  'apps/sim/app/api/credential-sets/invitations/route.ts',
  'apps/sim/app/api/workspaces/invitations/route.ts',
  // Document preview routes delegate validation to
  // `createDocumentPreviewRoute(...)`, which calls `safeParse` on the
  // contract-owned `routeParamsSchema` and `previewBodySchema`.
  'apps/sim/app/api/workspaces/[id]/pdf/preview/route.ts',
  'apps/sim/app/api/workspaces/[id]/pptx/preview/route.ts',
  'apps/sim/app/api/workspaces/[id]/docx/preview/route.ts',
])

const CONTRACT_IMPORT_PATTERN = /\bfrom\s+['"]@\/lib\/api\/contracts(?:\/[^'"]*)?['"]/
const SERVER_VALIDATION_IMPORT_PATTERN = /\bfrom\s+['"]@\/lib\/api\/server(?:\/validation)?['"]/
const SCHEMA_PARSE_PATTERN = /\b\w+Schema\.(?:safeParse|parse)\(/
const VALIDATE_SCHEMA_CALL_PATTERN = /\bvalidateSchema\(\s*\w+Schema\b/
const CONTRACT_SERVER_HELPER_PATTERN =
  /\b(?:parseAwsToolRequest|parseDatabaseToolRequest|validateJsonBody)\(/
const CANONICAL_HELPER_USAGE_PATTERN =
  /\b(?:isZodError|validationErrorResponse|validationErrorResponseFromError|getValidationErrorMessage)\s*\(/
const CONTRACT_MAP_PARSE_PATTERN =
  /\b\w+ContractsByPath[\s\S]{0,600}\.(?:body|query|params)!?\.(?:safeParse|parse)\(/
const ZOD_IMPORT_PATTERN = /\bfrom\s+['"]zod['"]/
const ZOD_REQUIRE_PATTERN = /\brequire\(['"]zod['"]\)/
const ZOD_SCHEMA_CONSTRUCTOR_PATTERN =
  /\bz\.(?:object|string|number|boolean|array|enum|nativeEnum|union|discriminatedUnion|record|literal|tuple|preprocess|coerce|date|unknown|any|instanceof|custom|lazy)\s*\(/g
const ZOD_ERROR_PATTERN = /\bZodError\b|\bz\.ZodError\b/
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage'])
const WIRE_TYPE_DECLARATION_PATTERN =
  /(?:^|\n)\s*(?:export\s+)?(interface|type)\s+([A-Z]\w*(?:Response|Result))\b(?=\s*(?:=|extends|\{))/g
const CONTRACT_DERIVED_WIRE_TYPE_PATTERN =
  /\b(?:ContractJsonResponse|ContractJsonErrorResponse|z\.(?:input|output|infer))\b/

interface RouteAudit {
  path: string
  usesZod: boolean
  hasZodImport: boolean
  schemaConstructorCount: number
  hasZodErrorReference: boolean
  hasBodyRead: boolean
  hasQueryRead: boolean
  hasFormDataRead: boolean
  hasParamsContext: boolean
}

interface WireTypeFinding {
  path: string
  name: string
  line: number
}

interface QueryHookAudit {
  path: string
  hasZodImport: boolean
  schemaConstructorCount: number
  adHocWireTypes: WireTypeFinding[]
}

interface FamilyStats {
  total: number
  zod: number
  nonZod: number
}

type BoundaryPolicyKey = keyof typeof BOUNDARY_POLICY_BASELINE

interface BoundaryPolicyMetric {
  key: BoundaryPolicyKey
  label: string
  current: number
}

interface PrintOnlyBoundaryPolicyMetric {
  label: string
  current: number
}

async function walk(
  dir: string,
  shouldIncludeFile: (fileName: string) => boolean,
  results: string[] = []
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath, shouldIncludeFile, results)
    } else if (shouldIncludeFile(entry.name)) {
      results.push(fullPath)
    }
  }

  return results
}

function lineNumberForIndex(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

function routeFamily(routePath: string): string {
  const relative = routePath.replace(/^apps\/sim\/app\/api\//, '')
  const [first, second] = relative.split('/')

  if (first === 'tools') return `tools/${second ?? 'unknown'}`
  if (first === 'v1') return second ? `v1/${second}` : 'v1'
  return first ?? 'unknown'
}

function hasZodUsage(relativePath: string, content: string): boolean {
  if (ZOD_IMPORT_PATTERN.test(content) || ZOD_REQUIRE_PATTERN.test(content)) {
    return true
  }
  if (
    /\bparseRequest\(/.test(content) &&
    /\bfrom\s+['"]@\/lib\/api\/server['"]/.test(content) &&
    CONTRACT_IMPORT_PATTERN.test(content)
  ) {
    return true
  }
  if (
    CONTRACT_IMPORT_PATTERN.test(content) &&
    (SCHEMA_PARSE_PATTERN.test(content) || CONTRACT_MAP_PARSE_PATTERN.test(content))
  ) {
    return true
  }
  if (CONTRACT_IMPORT_PATTERN.test(content) && CONTRACT_SERVER_HELPER_PATTERN.test(content)) {
    return true
  }
  if (
    CONTRACT_IMPORT_PATTERN.test(content) &&
    SERVER_VALIDATION_IMPORT_PATTERN.test(content) &&
    CANONICAL_HELPER_USAGE_PATTERN.test(content)
  ) {
    return true
  }
  if (
    SERVER_VALIDATION_IMPORT_PATTERN.test(content) &&
    /\b(?:isZodError|validationErrorResponseFromError|validateSchema)\b/.test(content) &&
    (SCHEMA_PARSE_PATTERN.test(content) || VALIDATE_SCHEMA_CALL_PATTERN.test(content))
  ) {
    return true
  }
  // Routes that import contract schemas and validate via the v1 helpers
  // (`validateSchema(schema, ...)` from `@/app/api/v1/knowledge/utils`) rely
  // on Zod indirectly. Treat them as Zod-backed.
  if (CONTRACT_IMPORT_PATTERN.test(content) && /\bvalidateSchema\(\w+Schema\b/.test(content)) {
    return true
  }

  return INDIRECT_ZOD_ROUTES.has(relativePath)
}

function auditRoute(filePath: string, content: string): RouteAudit {
  const relativePath = path.relative(ROOT, filePath)
  const schemaConstructorCount = [...content.matchAll(ZOD_SCHEMA_CONSTRUCTOR_PATTERN)].length

  return {
    path: relativePath,
    usesZod: hasZodUsage(relativePath, content),
    hasZodImport: ZOD_IMPORT_PATTERN.test(content) || ZOD_REQUIRE_PATTERN.test(content),
    schemaConstructorCount,
    hasZodErrorReference: ZOD_ERROR_PATTERN.test(content),
    hasBodyRead: /\brequest\.json\(\)|\breq\.json\(\)/.test(content),
    hasQueryRead: /\.searchParams\b|new URL\([^)]*\)\.searchParams/.test(content),
    hasFormDataRead: /\.formData\(\)/.test(content),
    hasParamsContext: /\bparams\b/.test(content) && /\bPromise<\{|\bRouteContext\b/.test(content),
  }
}

function findAdHocWireTypes(filePath: string, content: string): WireTypeFinding[] {
  const findings: WireTypeFinding[] = []
  const relativePath = path.relative(ROOT, filePath)

  for (const match of content.matchAll(WIRE_TYPE_DECLARATION_PATTERN)) {
    const kind = match[1]
    const name = match[2]
    const declarationStart = match.index ?? 0
    const declarationPreview = content.slice(declarationStart, declarationStart + 800)

    if (name.endsWith('QueryResult')) continue
    if (CONTRACT_DERIVED_WIRE_TYPE_PATTERN.test(declarationPreview)) continue
    if (kind === 'type') {
      const equalsIndex = declarationPreview.indexOf('=')
      const typeBody = declarationPreview.slice(equalsIndex + 1).trimStart()
      if (!typeBody.startsWith('{') && !/^[A-Z]\w*\s*&\s*\{/.test(typeBody)) {
        continue
      }
    }

    findings.push({
      path: relativePath,
      name,
      line: lineNumberForIndex(content, declarationStart),
    })
  }

  return findings
}

function auditQueryHook(filePath: string, content: string): QueryHookAudit {
  const relativePath = path.relative(ROOT, filePath)
  const schemaConstructorCount = [...content.matchAll(ZOD_SCHEMA_CONSTRUCTOR_PATTERN)].length

  return {
    path: relativePath,
    hasZodImport: ZOD_IMPORT_PATTERN.test(content) || ZOD_REQUIRE_PATTERN.test(content),
    schemaConstructorCount,
    adHocWireTypes: findAdHocWireTypes(filePath, content),
  }
}

function printFamilyStats(audits: RouteAudit[]) {
  const families = new Map<string, FamilyStats>()

  for (const audit of audits) {
    const family = routeFamily(audit.path)
    const stats = families.get(family) ?? { total: 0, zod: 0, nonZod: 0 }
    stats.total += 1
    if (audit.usesZod) {
      stats.zod += 1
    } else {
      stats.nonZod += 1
    }
    families.set(family, stats)
  }

  console.log('\nFamily breakdown:')
  for (const [family, stats] of [...families.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${family.padEnd(32)} total=${String(stats.total).padStart(3)} zod=${String(stats.zod).padStart(3)} nonZod=${String(stats.nonZod).padStart(3)}`
    )
  }
}

function printRiskyNonZodRoutes(audits: RouteAudit[]) {
  const risky = audits.filter(
    (audit) =>
      !audit.usesZod &&
      (audit.hasBodyRead || audit.hasQueryRead || audit.hasFormDataRead || audit.hasParamsContext)
  )

  console.log(`\nNon-Zod routes with parsed inputs: ${risky.length}`)
  for (const audit of risky.slice(0, 50)) {
    const markers = [
      audit.hasBodyRead ? 'json' : null,
      audit.hasFormDataRead ? 'formData' : null,
      audit.hasQueryRead ? 'query' : null,
      audit.hasParamsContext ? 'params' : null,
    ].filter(Boolean)
    console.log(`  ${audit.path} (${markers.join(', ')})`)
  }

  if (risky.length > 50) {
    console.log(`  ... ${risky.length - 50} more`)
  }
}

function printAllNonZodRoutes(audits: RouteAudit[]) {
  if (!process.argv.includes('--list-non-zod')) return

  const nonZod = audits.filter((audit) => !audit.usesZod)

  console.log(`\nAll non-Zod routes: ${nonZod.length}`)
  for (const audit of nonZod) {
    const markers = [
      audit.hasBodyRead ? 'json' : null,
      audit.hasFormDataRead ? 'formData' : null,
      audit.hasQueryRead ? 'query' : null,
      audit.hasParamsContext ? 'params' : null,
    ].filter(Boolean)
    console.log(`  ${audit.path}${markers.length > 0 ? ` (${markers.join(', ')})` : ''}`)
  }
}

function buildBoundaryPolicyMetrics(
  routeAudits: RouteAudit[],
  queryHookAudits: QueryHookAudit[]
): {
  ratchetedMetrics: BoundaryPolicyMetric[]
  printOnlyMetrics: PrintOnlyBoundaryPolicyMetric[]
} {
  const routeZodImports = routeAudits.filter((audit) => audit.hasZodImport)
  const routeLocalSchemaRoutes = routeAudits.filter((audit) => audit.schemaConstructorCount > 0)
  const routeLocalSchemaConstructors = routeLocalSchemaRoutes.reduce(
    (total, audit) => total + audit.schemaConstructorCount,
    0
  )
  const routeZodErrorReferences = routeAudits.filter((audit) => audit.hasZodErrorReference)
  const queryHookZodImports = queryHookAudits.filter((audit) => audit.hasZodImport)
  const queryHookLocalSchemaFiles = queryHookAudits.filter(
    (audit) => audit.schemaConstructorCount > 0
  )
  const queryHookLocalSchemaConstructors = queryHookLocalSchemaFiles.reduce(
    (total, audit) => total + audit.schemaConstructorCount,
    0
  )
  const queryHookAdHocWireTypes = queryHookAudits.flatMap((audit) => audit.adHocWireTypes)

  return {
    ratchetedMetrics: [
      {
        key: 'routeZodImports',
        label: 'route files importing zod',
        current: routeZodImports.length,
      },
      {
        key: 'routeLocalSchemaRoutes',
        label: 'route files with local schema constructors',
        current: routeLocalSchemaRoutes.length,
      },
      {
        key: 'routeLocalSchemaConstructors',
        label: 'route local schema constructor calls',
        current: routeLocalSchemaConstructors,
      },
      {
        key: 'routeZodErrorReferences',
        label: 'route files referencing ZodError',
        current: routeZodErrorReferences.length,
      },
      {
        key: 'clientHookZodImports',
        label: 'client hook files importing zod',
        current: queryHookZodImports.length,
      },
      {
        key: 'clientHookLocalSchemaFiles',
        label: 'client hook files with local schema constructors',
        current: queryHookLocalSchemaFiles.length,
      },
      {
        key: 'clientHookLocalSchemaConstructors',
        label: 'client hook local schema constructor calls',
        current: queryHookLocalSchemaConstructors,
      },
    ],
    printOnlyMetrics: [
      {
        label: 'client hook ad-hoc wire Response/Result types',
        current: queryHookAdHocWireTypes.length,
      },
    ],
  }
}

function printBoundaryPolicyMetric(metric: BoundaryPolicyMetric) {
  const baseline = BOUNDARY_POLICY_BASELINE[metric.key]
  const delta = metric.current - baseline
  const deltaText = delta === 0 ? 'at baseline' : `${delta > 0 ? '+' : ''}${delta} vs baseline`
  console.log(`  ${metric.label}: ${metric.current} (${deltaText})`)
}

function printBoundaryContractDrift(
  routeAudits: RouteAudit[],
  queryHookAudits: QueryHookAudit[],
  ratchetedMetrics: BoundaryPolicyMetric[],
  printOnlyMetrics: PrintOnlyBoundaryPolicyMetric[]
) {
  const zodImportRoutes = routeAudits.filter((audit) => audit.hasZodImport)
  const localSchemaRoutes = routeAudits.filter((audit) => audit.schemaConstructorCount > 0)
  const zodErrorRoutes = routeAudits.filter((audit) => audit.hasZodErrorReference)
  const zodImportQueryHooks = queryHookAudits.filter((audit) => audit.hasZodImport)
  const localSchemaQueryHooks = queryHookAudits.filter((audit) => audit.schemaConstructorCount > 0)
  const adHocWireTypes = queryHookAudits.flatMap((audit) => audit.adHocWireTypes)

  console.log('\nBoundary policy drift:')
  console.log('  ratcheted metrics:')
  for (const metric of ratchetedMetrics) {
    printBoundaryPolicyMetric(metric)
  }
  console.log('  print-only heuristics:')
  for (const metric of printOnlyMetrics) {
    console.log(`  ${metric.label}: ${metric.current}`)
  }
  console.log(
    '  ratchet enforcement: pass --enforce-boundary-baseline to fail on ratcheted metric increases'
  )
  console.log('  ratchet update: lower BOUNDARY_POLICY_BASELINE after reducing a ratcheted count')

  console.log('\nBoundary policy examples:')
  console.log('  route zod import examples:')
  for (const audit of zodImportRoutes.slice(0, 25)) {
    console.log(`    ${audit.path}`)
  }

  if (zodImportRoutes.length > 25) {
    console.log(`    ... ${zodImportRoutes.length - 25} more`)
  }

  console.log('  route local schema constructor examples:')
  for (const audit of localSchemaRoutes.slice(0, 25)) {
    console.log(`    ${audit.path} (${audit.schemaConstructorCount})`)
  }

  if (localSchemaRoutes.length > 25) {
    console.log(`    ... ${localSchemaRoutes.length - 25} more`)
  }

  console.log('  route ZodError reference examples:')
  for (const audit of zodErrorRoutes.slice(0, 25)) {
    console.log(`    ${audit.path}`)
  }

  if (zodErrorRoutes.length > 25) {
    console.log(`    ... ${zodErrorRoutes.length - 25} more`)
  }

  console.log('  client hook zod import examples:')
  for (const audit of zodImportQueryHooks.slice(0, 25)) {
    console.log(`    ${audit.path}`)
  }

  if (zodImportQueryHooks.length > 25) {
    console.log(`    ... ${zodImportQueryHooks.length - 25} more`)
  }

  console.log('  query-hook local schema constructor examples:')
  for (const audit of localSchemaQueryHooks.slice(0, 25)) {
    console.log(`    ${audit.path} (${audit.schemaConstructorCount})`)
  }

  if (localSchemaQueryHooks.length > 25) {
    console.log(`    ... ${localSchemaQueryHooks.length - 25} more`)
  }

  console.log('  query-hook ad-hoc wire type examples:')
  for (const finding of adHocWireTypes.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.name}`)
  }

  if (adHocWireTypes.length > 25) {
    console.log(`    ... ${adHocWireTypes.length - 25} more`)
  }
}

function boundaryPolicyFailures(metrics: BoundaryPolicyMetric[]): string[] {
  return metrics
    .filter((metric) => metric.current > BOUNDARY_POLICY_BASELINE[metric.key])
    .map(
      (metric) =>
        `${metric.label} increased from ${BOUNDARY_POLICY_BASELINE[metric.key]} to ${metric.current}`
    )
}

async function auditQueryHooks(): Promise<QueryHookAudit[]> {
  const queryHookFiles = await walk(
    QUERY_HOOKS_DIR,
    (fileName) => /\.(ts|tsx)$/.test(fileName) && !/\.test\.(ts|tsx)$/.test(fileName)
  )
  const audits: QueryHookAudit[] = []

  for (const filePath of queryHookFiles) {
    const content = await readFile(filePath, 'utf8')
    audits.push(auditQueryHook(filePath, content))
  }

  return audits
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const enforceBoundaryBaseline = process.argv.includes('--enforce-boundary-baseline')
  const routeFiles = await walk(API_DIR, (fileName) => fileName === 'route.ts')
  const audits: RouteAudit[] = []

  for (const filePath of routeFiles) {
    const content = await readFile(filePath, 'utf8')
    audits.push(auditRoute(filePath, content))
  }
  const queryHookAudits = await auditQueryHooks()
  const { ratchetedMetrics, printOnlyMetrics } = buildBoundaryPolicyMetrics(audits, queryHookAudits)

  const totalRoutes = audits.length
  const zodRoutes = audits.filter((audit) => audit.usesZod).length
  const nonZodRoutes = totalRoutes - zodRoutes

  console.log('API validation route audit')
  console.log(`  total routes: ${totalRoutes}`)
  console.log(`  Zod-backed routes: ${zodRoutes}`)
  console.log(`  non-Zod routes: ${nonZodRoutes}`)
  console.log(
    `  baseline: total=${BASELINE.totalRoutes} zod=${BASELINE.zodRoutes} nonZod=${BASELINE.nonZodRoutes}`
  )

  printFamilyStats(audits)
  printRiskyNonZodRoutes(audits)
  printAllNonZodRoutes(audits)
  printBoundaryContractDrift(audits, queryHookAudits, ratchetedMetrics, printOnlyMetrics)

  if (!checkOnly) return

  const failures: string[] = []
  if (totalRoutes > BASELINE.totalRoutes) {
    failures.push(`route count increased from ${BASELINE.totalRoutes} to ${totalRoutes}`)
  }
  if (nonZodRoutes > BASELINE.nonZodRoutes) {
    failures.push(
      `non-Zod routes increased from ${BASELINE.nonZodRoutes} to ${nonZodRoutes} (${zodRoutes} Zod-backed routes)`
    )
  }
  if (enforceBoundaryBaseline) {
    failures.push(...boundaryPolicyFailures(ratchetedMetrics))
  }

  if (failures.length > 0) {
    console.error('\nAPI validation audit failed:')
    for (const failure of failures) {
      console.error(`  - ${failure}`)
    }
    process.exit(1)
  }

  console.log('\nAPI validation audit passed.')
}

void main().catch((error) => {
  console.error('API validation audit failed:', error)
  process.exit(1)
})
