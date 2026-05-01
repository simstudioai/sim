#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const API_DIR = path.join(ROOT, 'apps/sim/app/api')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts')
const QUERY_HOOKS_DIR = path.join(ROOT, 'apps/sim/hooks/queries')
const SELECTOR_HOOKS_DIR = path.join(ROOT, 'apps/sim/hooks/selectors')

const BASELINE = {
  totalRoutes: 715,
  zodRoutes: 715,
  nonZodRoutes: 0,
} as const

const BOUNDARY_POLICY_BASELINE = {
  routeZodImports: 0,
  routeLocalSchemaRoutes: 0,
  routeLocalSchemaConstructors: 0,
  routeZodErrorReferences: 0,
  clientHookZodImports: 0,
  clientHookLocalSchemaFiles: 0,
  clientHookLocalSchemaConstructors: 0,
  clientHookRawFetches: 0,
  clientSameOriginApiFetches: 0,
  doubleCasts: 8,
  rawJsonReads: 21,
  untypedResponses: 0,
  annotationsMissingReason: 0,
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
  // Internal cron entry point that authenticates via `Authorization: Bearer
  // CRON_SECRET` and ignores query/body. The boundary contract is "no
  // client-supplied input"; query params from external callers are not
  // consumed.
  'apps/sim/app/api/schedules/execute/route.ts',
  // Document preview routes delegate validation to
  // `createDocumentPreviewRoute(...)`, which calls `safeParse` on the
  // contract-owned `routeParamsSchema` and `previewBodySchema`.
  'apps/sim/app/api/workspaces/[id]/pdf/preview/route.ts',
  'apps/sim/app/api/workspaces/[id]/pptx/preview/route.ts',
  'apps/sim/app/api/workspaces/[id]/docx/preview/route.ts',
  // Routes with no client-supplied input. Auth is handled via session/cron/internal
  // tokens and there are no params, query, or body to validate. Previously had
  // no-op `validateSchema(noInputSchema, {})` guards.
  'apps/sim/app/api/health/route.ts',
  'apps/sim/app/api/settings/allowed-providers/route.ts',
  'apps/sim/app/api/settings/allowed-integrations/route.ts',
  'apps/sim/app/api/settings/allowed-mcp-domains/route.ts',
  'apps/sim/app/api/cron/cleanup-tasks/route.ts',
  'apps/sim/app/api/cron/cleanup-soft-deletes/route.ts',
  'apps/sim/app/api/cron/cleanup-stale-executions/route.ts',
  'apps/sim/app/api/cron/renew-subscriptions/route.ts',
  'apps/sim/app/api/logs/cleanup/route.ts',
  'apps/sim/app/api/knowledge/connectors/sync/route.ts',
  'apps/sim/app/api/webhooks/outbox/process/route.ts',
  'apps/sim/app/api/webhooks/cleanup/idempotency/route.ts',
  // MCP routes that take only auth context (no client-supplied params/query/body).
  'apps/sim/app/api/mcp/discover/route.ts',
  'apps/sim/app/api/mcp/tools/stored/route.ts',
])

/**
 * Routes baseline-allowed to use `await request.json()` / `await req.json()`
 * directly (without an inline `// boundary-raw-json:` annotation).
 *
 * These are legitimately partial: tolerant body parses (`.catch(() => ({}))`),
 * JSON-RPC envelopes that need their own dispatch, multi-stage MCP routes that
 * read pre-parsed bodies, and routes whose Zod-backed migration is queued
 * behind a separate contract / schema authoring step. New routes must NOT
 * introduce raw `await request.json()` reads — annotate the call with
 * `// boundary-raw-json: <reason>` instead.
 */
const RAW_JSON_BASELINE_ROUTES = new Set([
  'apps/sim/app/api/a2a/serve/[agentId]/route.ts',
  'apps/sim/app/api/billing/portal/route.ts',
  'apps/sim/app/api/contact/route.ts',
  'apps/sim/app/api/copilot/api-keys/generate/route.ts',
  'apps/sim/app/api/copilot/api-keys/validate/route.ts',
  'apps/sim/app/api/copilot/chat/abort/route.ts',
  'apps/sim/app/api/copilot/stats/route.ts',
  'apps/sim/app/api/folders/[id]/restore/route.ts',
  'apps/sim/app/api/invitations/[id]/accept/route.ts',
  'apps/sim/app/api/invitations/[id]/reject/route.ts',
  'apps/sim/app/api/invitations/[id]/route.ts',
  'apps/sim/app/api/knowledge/[id]/documents/route.ts',
  'apps/sim/app/api/knowledge/[id]/documents/[documentId]/chunks/route.ts',
  'apps/sim/app/api/mcp/copilot/route.ts',
  'apps/sim/app/api/mcp/serve/[serverId]/route.ts',
  'apps/sim/app/api/mcp/servers/route.ts',
  'apps/sim/app/api/mcp/servers/[id]/route.ts',
  'apps/sim/app/api/mcp/servers/test-connection/route.ts',
  'apps/sim/app/api/mcp/tools/discover/route.ts',
  'apps/sim/app/api/mcp/tools/execute/route.ts',
  'apps/sim/app/api/mcp/workflow-servers/route.ts',
  'apps/sim/app/api/mcp/workflow-servers/[id]/route.ts',
  'apps/sim/app/api/mcp/workflow-servers/[id]/tools/route.ts',
  'apps/sim/app/api/mcp/workflow-servers/[id]/tools/[toolId]/route.ts',
  'apps/sim/app/api/organizations/route.ts',
  'apps/sim/app/api/organizations/[id]/invitations/route.ts',
  'apps/sim/app/api/organizations/[id]/members/route.ts',
  'apps/sim/app/api/organizations/[id]/transfer-ownership/route.ts',
  'apps/sim/app/api/resume/[workflowId]/[executionId]/[contextId]/route.ts',
  'apps/sim/app/api/speech/token/route.ts',
  'apps/sim/app/api/table/[tableId]/rows/route.ts',
  'apps/sim/app/api/tools/file/manage/route.ts',
  'apps/sim/app/api/workspaces/invitations/batch/route.ts',
  'apps/sim/app/api/workspaces/[id]/route.ts',
  'apps/sim/app/api/workspaces/[id]/files/[fileId]/route.ts',
  'apps/sim/app/api/workspaces/[id]/files/[fileId]/content/route.ts',
])

const CONTRACT_IMPORT_PATTERN = /\bfrom\s+['"]@\/lib\/api\/contracts(?:\/[^'"]*)?['"]/
const SERVER_VALIDATION_IMPORT_PATTERN = /\bfrom\s+['"]@\/lib\/api\/server(?:\/validation)?['"]/
const SCHEMA_PARSE_PATTERN = /\b\w+Schema\.(?:safeParse|parse)\(/
const CONTRACT_SERVER_HELPER_PATTERN = /\bparseToolRequest\(/
const CANONICAL_HELPER_USAGE_PATTERN =
  /\b(?:isZodError|validationErrorResponse|validationErrorResponseFromError|getValidationErrorMessage)\s*\(/
const CONTRACT_MAP_PARSE_PATTERN =
  /\b\w+ContractsByPath[\s\S]{0,600}\.(?:body|query|params)!?\.(?:safeParse|parse)\(/
/**
 * Matches `from 'zod'` and any zod subpath import like `from 'zod/v4'` or
 * `from 'zod/mini'`. The capturing-group-free alternation keeps this safe to
 * use with `.test(...)` and `.replace(...)` callers.
 */
const ZOD_IMPORT_PATTERN = /\bfrom\s+['"]zod(?:\/[^'"]+)?['"]/
const ZOD_REQUIRE_PATTERN = /\brequire\(['"]zod(?:\/[^'"]+)?['"]\)/
const ZOD_SCHEMA_CONSTRUCTOR_PATTERN =
  /\bz\.(?:object|string|number|boolean|array|enum|nativeEnum|union|discriminatedUnion|record|literal|tuple|preprocess|coerce|date|unknown|any|instanceof|custom|lazy)\s*\(/g
const ZOD_ERROR_PATTERN = /\bZodError\b|\bz\.ZodError\b/
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage'])
const WIRE_TYPE_DECLARATION_PATTERN =
  /(?:^|\n)\s*(?:export\s+)?(interface|type)\s+([A-Z]\w*(?:Response|Result))\b(?=\s*(?:=|extends|\{))/g
const CONTRACT_DERIVED_WIRE_TYPE_PATTERN =
  /\b(?:ContractJsonResponse|ContractJsonErrorResponse|z\.(?:input|output|infer))\b/

const RAW_FETCH_PATTERN = /\bfetch\(/g
const RAW_FETCH_HELPER_GUARD_PATTERN = /(?:requestJson|requestRaw|prefetchJson|preFetchJson)$/
/**
 * Matches `fetch(` (with optional whitespace, including newlines) followed by
 * a string literal — single quote, double quote, or template literal —
 * whose first character is `/api/`. This catches same-origin internal API
 * fetches in any non-test source file under `apps/sim/**` that aren't an
 * `app/api/**\/route.ts` server handler. Template literals with leading
 * interpolations (e.g. `${base}/api/foo`) are intentionally NOT matched
 * because they're rare and could trigger false positives on non-`/api/` URLs.
 */
const SAME_ORIGIN_API_FETCH_PATTERN = /\bfetch\(\s*[`'"]\/api\//g
const DOUBLE_CAST_PATTERN = /\bas unknown as\b/g
/**
 * Matches `await request.json()` / `await req.json()` and the multi-line
 * `await request.clone().json()` clone-then-read variant. Both forms read
 * the request body without going through `parseRequest(...)` / a contract
 * and count toward the `rawJsonReads` ratchet.
 *
 * `\s` is multi-line (handles common Prettier/Biome formatting where the
 * `.clone()` and `.json()` calls land on separate lines).
 */
const RAW_JSON_READ_PATTERN =
  /\bawait\s+(?:request|req)\s*(?:\.\s*clone\s*\(\s*\))?\s*\.\s*json\s*\(\s*\)/g
/**
 * Matches `schema:` followed directly by a "validates nothing" zod construct.
 * Three forms are treated equivalently:
 *   1. `schema: z.unknown()` — no validation at all.
 *   2. `schema: z.object({}).passthrough()` — validates only that the value
 *      is an object; allows any keys/values.
 *   3. `schema: z.record(z.string(), z.unknown())` — validates only that the
 *      value is a string-keyed object; values are arbitrary.
 *
 * Anchored on the literal `schema:` token so that nested `z.unknown()` /
 * `z.object({}).passthrough()` uses inside an otherwise-typed object schema
 * are NOT flagged — only the top-level response declaration in
 * `defineRouteContract({ ..., response: { mode: 'json', schema: ... } })`.
 */
const UNTYPED_RESPONSE_PATTERN =
  /\bschema\s*:\s*(?:z\.unknown\s*\(\s*\)|z\.object\s*\(\s*\{\s*\}\s*\)\s*\.passthrough\s*\(\s*\)|z\.record\s*\(\s*z\.string\s*\(\s*\)\s*,\s*z\.unknown\s*\(\s*\)\s*\))/g
const RAW_FETCH_ANNOTATION_PREFIX = '// boundary-raw-fetch:'
const DOUBLE_CAST_ANNOTATION_PREFIX = '// double-cast-allowed:'
const RAW_JSON_ANNOTATION_PREFIX = '// boundary-raw-json:'
const UNTYPED_RESPONSE_ANNOTATION_PREFIX = '// untyped-response:'
const SOURCE_FILE_EXTENSIONS = /\.(?:ts|tsx)$/
const TEST_FILE_PATTERN = /(?:\.test|\.spec)\.(?:ts|tsx)$/
const TEST_HELPER_FILE_PATTERN = /(?:^|\/)test-[^/]+\.ts$/
const TEST_DIR_SEGMENT_PATTERN = /(?:^|\/)(?:__tests__|testing)(?:\/|$)/
/**
 * Skips user-uploaded content stored under `apps/sim/uploads/...` (workspace
 * file uploads, etc.). Does NOT match `apps/sim/lib/uploads/...`, which is
 * source code for the uploads subsystem.
 */
const USER_UPLOADS_DIR_PATTERN = /(?:^|\/)apps\/sim\/uploads(?:\/|$)/
const SOURCE_SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  '__tests__',
  'testing',
])

type AnnotationKind = 'raw-fetch' | 'double-cast' | 'raw-json' | 'untyped-response'

interface AnnotationResult {
  allowed: boolean
  missingReason: boolean
}

interface RawFetchFinding {
  path: string
  line: number
  preview: string
}

interface SameOriginApiFetchFinding {
  path: string
  line: number
  preview: string
}

interface DoubleCastFinding {
  path: string
  line: number
  preview: string
}

interface RawJsonFinding {
  path: string
  line: number
  preview: string
}

interface UntypedResponseFinding {
  path: string
  line: number
  preview: string
}

interface AnnotationMissingReasonFinding {
  path: string
  line: number
  kind: AnnotationKind
}

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

/**
 * Inspects up to three consecutive non-empty preceding lines for an
 * opt-out annotation matching the given kind. The annotation is allowed
 * when the matching prefix is followed by a non-empty reason. When the
 * prefix is present but the reason is empty, `missingReason` is set so
 * the audit can flag and fail on dangling annotations.
 */
function extractAnnotation(
  content: string,
  lineIndex: number,
  kind: AnnotationKind
): AnnotationResult {
  const prefix =
    kind === 'raw-fetch'
      ? RAW_FETCH_ANNOTATION_PREFIX
      : kind === 'double-cast'
        ? DOUBLE_CAST_ANNOTATION_PREFIX
        : kind === 'raw-json'
          ? RAW_JSON_ANNOTATION_PREFIX
          : UNTYPED_RESPONSE_ANNOTATION_PREFIX
  const lines = content.split('\n')
  let inspected = 0

  for (let i = lineIndex - 1; i >= 0 && inspected < 3; i -= 1) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed.length === 0) continue
    inspected += 1

    if (!trimmed.startsWith('//')) {
      return { allowed: false, missingReason: false }
    }

    const prefixIndex = trimmed.indexOf(prefix)
    if (prefixIndex === -1) continue

    const reason = trimmed.slice(prefixIndex + prefix.length).trim()
    if (reason.length === 0) {
      return { allowed: false, missingReason: true }
    }
    return { allowed: true, missingReason: false }
  }

  return { allowed: false, missingReason: false }
}

/**
 * Walks `apps/sim/**` and optionally `packages/**` for `.ts` / `.tsx`
 * source files, excluding tests, build artifacts, and coverage output.
 * Kept separate from `walk(API_DIR)` because the source-wide audit has
 * different exclusion rules than the route audit.
 */
async function walkAllSourceFiles(root: string, includePackages: boolean): Promise<string[]> {
  const roots = includePackages
    ? [path.join(root, 'apps/sim'), path.join(root, 'packages')]
    : [path.join(root, 'apps/sim')]
  const results: string[] = []

  for (const start of roots) {
    await walkSourceTree(start, results)
  }

  return results
}

async function walkSourceTree(dir: string, results: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (SOURCE_SKIP_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkSourceTree(fullPath, results)
      continue
    }

    if (!SOURCE_FILE_EXTENSIONS.test(entry.name)) continue
    if (TEST_FILE_PATTERN.test(entry.name)) continue
    if (TEST_HELPER_FILE_PATTERN.test(entry.name)) continue
    if (TEST_DIR_SEGMENT_PATTERN.test(fullPath)) continue
    if (USER_UPLOADS_DIR_PATTERN.test(fullPath)) continue

    results.push(fullPath)
  }
}

function isContractFetchHelperCall(line: string, matchIndex: number): boolean {
  const before = line.slice(0, matchIndex)
  return RAW_FETCH_HELPER_GUARD_PATTERN.test(before)
}

function buildPreview(line: string): string {
  return line.trim().slice(0, 160)
}

function findRawFetchFindings(
  filePath: string,
  content: string
): {
  findings: RawFetchFinding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
} {
  const relativePath = path.relative(ROOT, filePath)
  const lines = content.split('\n')
  const findings: RawFetchFinding[] = []
  const missingReasons: AnnotationMissingReasonFinding[] = []
  let exemptions = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    RAW_FETCH_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = RAW_FETCH_PATTERN.exec(line)) !== null) {
      if (isContractFetchHelperCall(line, match.index)) continue

      const annotation = extractAnnotation(content, i, 'raw-fetch')
      if (annotation.missingReason) {
        missingReasons.push({ path: relativePath, line: i + 1, kind: 'raw-fetch' })
        findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
        continue
      }
      if (annotation.allowed) {
        exemptions += 1
        continue
      }
      findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
    }
  }

  return { findings, exemptions, missingReasons }
}

function findDoubleCastFindings(
  filePath: string,
  content: string
): {
  findings: DoubleCastFinding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
} {
  const relativePath = path.relative(ROOT, filePath)
  const lines = content.split('\n')
  const findings: DoubleCastFinding[] = []
  const missingReasons: AnnotationMissingReasonFinding[] = []
  let exemptions = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    DOUBLE_CAST_PATTERN.lastIndex = 0
    while (DOUBLE_CAST_PATTERN.exec(line) !== null) {
      const annotation = extractAnnotation(content, i, 'double-cast')
      if (annotation.missingReason) {
        missingReasons.push({ path: relativePath, line: i + 1, kind: 'double-cast' })
        findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
        continue
      }
      if (annotation.allowed) {
        exemptions += 1
        continue
      }
      findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
    }
  }

  return { findings, exemptions, missingReasons }
}

/**
 * Inspect a route file for `await request.json()` / `await req.json()` reads.
 *
 * Returns one finding per unannotated read. Routes in
 * `RAW_JSON_BASELINE_ROUTES` are baseline-allowed: their reads still appear
 * in `findings` so the `rawJsonReads` ratcheted metric counts them, but they
 * are NOT required to carry per-line `// boundary-raw-json: <reason>`
 * annotations. The ratchet's enforcement is by file count
 * (see `buildBoundaryPolicyMetrics`): adding a raw read in a route outside
 * the baseline pushes the unique-file count above `BOUNDARY_POLICY_BASELINE.rawJsonReads`.
 *
 * Annotated reads (`// boundary-raw-json: <reason>` on one of the three
 * preceding non-empty lines) are treated as exemptions and excluded from
 * `findings`. An annotation with the prefix but an empty reason is flagged
 * via `missingReasons` and still counts as a finding.
 */
function findRawJsonFindings(
  filePath: string,
  content: string
): {
  findings: RawJsonFinding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
} {
  const relativePath = path.relative(ROOT, filePath)
  const lines = content.split('\n')
  const findings: RawJsonFinding[] = []
  const missingReasons: AnnotationMissingReasonFinding[] = []
  let exemptions = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    RAW_JSON_READ_PATTERN.lastIndex = 0
    while (RAW_JSON_READ_PATTERN.exec(line) !== null) {
      const annotation = extractAnnotation(content, i, 'raw-json')
      if (annotation.missingReason) {
        missingReasons.push({ path: relativePath, line: i + 1, kind: 'raw-json' })
        findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
        continue
      }
      if (annotation.allowed) {
        exemptions += 1
        continue
      }
      findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
    }
  }

  return { findings, exemptions, missingReasons }
}

/**
 * Inspect a contracts file for "validates nothing" response schema
 * declarations. Three forms are treated equivalently and all count toward
 * the `untypedResponses` ratchet:
 *   - `schema: z.unknown()`
 *   - `schema: z.object({}).passthrough()`
 *   - `schema: z.record(z.string(), z.unknown())`
 *
 * Anchored on `schema:` so nested uses inside an otherwise-typed object
 * (e.g. `output: z.unknown()` inside `z.object({ ... })`) are NOT flagged.
 * Each callsite must carry a `// untyped-response: <reason>` annotation on
 * one of the three preceding non-empty lines. Annotated callsites become
 * exemptions; un-annotated callsites become findings that count toward the
 * `untypedResponses` ratchet. An annotation with the prefix but an empty
 * reason is flagged via `missingReasons` and still counts as a finding.
 */
function findUntypedResponseFindings(
  filePath: string,
  content: string
): {
  findings: UntypedResponseFinding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
} {
  const relativePath = path.relative(ROOT, filePath)
  const lines = content.split('\n')
  const findings: UntypedResponseFinding[] = []
  const missingReasons: AnnotationMissingReasonFinding[] = []
  let exemptions = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    UNTYPED_RESPONSE_PATTERN.lastIndex = 0
    while (UNTYPED_RESPONSE_PATTERN.exec(line) !== null) {
      const annotation = extractAnnotation(content, i, 'untyped-response')
      if (annotation.missingReason) {
        missingReasons.push({ path: relativePath, line: i + 1, kind: 'untyped-response' })
        findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
        continue
      }
      if (annotation.allowed) {
        exemptions += 1
        continue
      }
      findings.push({ path: relativePath, line: i + 1, preview: buildPreview(line) })
    }
  }

  return { findings, exemptions, missingReasons }
}

function isClientHookFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return (
    normalized.startsWith(`${QUERY_HOOKS_DIR}/`) || normalized.startsWith(`${SELECTOR_HOOKS_DIR}/`)
  )
}

/**
 * Identifies `apps/sim/app/api/**\/route.ts` API route handlers. Same-origin
 * `/api/` fetch scanning skips these — server-side fetches from inside a
 * route handler are a different concern and are not what this ratchet is
 * trying to catch.
 */
function isApiRouteHandler(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  if (!normalized.startsWith(`${API_DIR}/`)) return false
  return normalized.endsWith('/route.ts')
}

/**
 * Inspect a non-API-route source file under `apps/sim/**` for raw
 * `fetch('/api/...')`, `fetch("/api/...")`, or ``fetch(`/api/...`)`` calls.
 *
 * Each callsite is either an exemption (annotated with
 * `// boundary-raw-fetch: <reason>` on one of the three preceding non-empty
 * lines) or a finding. The ratchet's enforcement is by unique-file count:
 * introducing a same-origin `/api/` fetch without an annotation pushes the
 * unique-file count above `BOUNDARY_POLICY_BASELINE.clientSameOriginApiFetches`
 * and fails the audit.
 *
 * Scanning runs over the entire file content (not line-by-line) so that
 * multi-line constructs like `fetch(\n  \`/api/...\`)` are still caught.
 * An annotation with the prefix but an empty reason is flagged via
 * `missingReasons` and still counts as a finding.
 */
function findSameOriginApiFetchFindings(
  filePath: string,
  content: string
): {
  findings: SameOriginApiFetchFinding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
} {
  const relativePath = path.relative(ROOT, filePath)
  const lines = content.split('\n')
  const findings: SameOriginApiFetchFinding[] = []
  const missingReasons: AnnotationMissingReasonFinding[] = []
  let exemptions = 0

  SAME_ORIGIN_API_FETCH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SAME_ORIGIN_API_FETCH_PATTERN.exec(content)) !== null) {
    const lineNumber = lineNumberForIndex(content, match.index)
    const lineIndex = lineNumber - 1
    const line = lines[lineIndex] ?? ''

    const annotation = extractAnnotation(content, lineIndex, 'raw-fetch')
    if (annotation.missingReason) {
      missingReasons.push({ path: relativePath, line: lineNumber, kind: 'raw-fetch' })
      findings.push({ path: relativePath, line: lineNumber, preview: buildPreview(line) })
      continue
    }
    if (annotation.allowed) {
      exemptions += 1
      continue
    }
    findings.push({ path: relativePath, line: lineNumber, preview: buildPreview(line) })
  }

  return { findings, exemptions, missingReasons }
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
    /\b(?:isZodError|validationErrorResponseFromError)\b/.test(content) &&
    SCHEMA_PARSE_PATTERN.test(content)
  ) {
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
  queryHookAudits: QueryHookAudit[],
  rawFetchSummary: { findings: RawFetchFinding[]; exemptions: number },
  sameOriginApiFetchSummary: {
    findings: SameOriginApiFetchFinding[]
    exemptions: number
  },
  doubleCastSummary: { findings: DoubleCastFinding[]; exemptions: number },
  rawJsonSummary: { findings: RawJsonFinding[]; exemptions: number },
  untypedResponseSummary: { findings: UntypedResponseFinding[]; exemptions: number },
  annotationsMissingReason: AnnotationMissingReasonFinding[]
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
      {
        key: 'clientHookRawFetches',
        label: 'client hook raw fetch() calls',
        current: rawFetchSummary.findings.length,
      },
      {
        key: 'clientSameOriginApiFetches',
        label: 'apps/sim files with raw same-origin /api/ fetch() calls',
        current: new Set(sameOriginApiFetchSummary.findings.map((finding) => finding.path)).size,
      },
      {
        key: 'doubleCasts',
        label: 'as unknown as double-casts (non-test)',
        current: doubleCastSummary.findings.length,
      },
      {
        key: 'rawJsonReads',
        label: 'route files with raw await request.json() reads',
        current: new Set(rawJsonSummary.findings.map((finding) => finding.path)).size,
      },
      {
        key: 'untypedResponses',
        label:
          'contract untyped response schemas (z.unknown / z.object({}).passthrough / z.record)',
        current: untypedResponseSummary.findings.length,
      },
      {
        key: 'annotationsMissingReason',
        label: 'audit annotations missing reason',
        current: annotationsMissingReason.length,
      },
    ],
    printOnlyMetrics: [
      {
        label: 'client hook ad-hoc wire Response/Result types',
        current: queryHookAdHocWireTypes.length,
      },
      {
        label: 'client hook raw fetch() exemptions (annotated)',
        current: rawFetchSummary.exemptions,
      },
      {
        label: 'apps/sim raw same-origin /api/ fetch() callsites',
        current: sameOriginApiFetchSummary.findings.length,
      },
      {
        label: 'apps/sim raw same-origin /api/ fetch() exemptions (annotated)',
        current: sameOriginApiFetchSummary.exemptions,
      },
      {
        label: 'as unknown as double-cast exemptions (annotated)',
        current: doubleCastSummary.exemptions,
      },
      {
        label: 'route raw await request.json() annotated exemptions',
        current: rawJsonSummary.exemptions,
      },
      {
        label: 'contract untyped response annotated exemptions',
        current: untypedResponseSummary.exemptions,
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

function printRawFetchAndDoubleCastMetrics(
  rawFetchFindings: RawFetchFinding[],
  sameOriginApiFetchFindings: SameOriginApiFetchFinding[],
  doubleCastFindings: DoubleCastFinding[],
  rawJsonFindings: RawJsonFinding[],
  untypedResponseFindings: UntypedResponseFinding[],
  annotationsMissingReason: AnnotationMissingReasonFinding[],
  rawFetchExemptions: number,
  sameOriginApiFetchExemptions: number,
  doubleCastExemptions: number,
  rawJsonExemptions: number,
  untypedResponseExemptions: number
) {
  console.log('\nRaw fetch and double-cast metrics:')
  console.log(`  client hook raw fetch() calls: ${rawFetchFindings.length}`)
  console.log(`  client hook raw fetch() exemptions (annotated): ${rawFetchExemptions}`)
  const sameOriginFiles = new Set(sameOriginApiFetchFindings.map((finding) => finding.path)).size
  console.log(
    `  apps/sim files with raw same-origin /api/ fetch() calls: ${sameOriginFiles} (baseline ${BOUNDARY_POLICY_BASELINE.clientSameOriginApiFetches})`
  )
  console.log(
    `  apps/sim raw same-origin /api/ fetch() callsites: ${sameOriginApiFetchFindings.length}`
  )
  console.log(
    `  apps/sim raw same-origin /api/ fetch() exemptions (annotated): ${sameOriginApiFetchExemptions}`
  )
  console.log(`  as unknown as double-casts (non-test): ${doubleCastFindings.length}`)
  console.log(`  as unknown as double-cast exemptions (annotated): ${doubleCastExemptions}`)
  const rawJsonFiles = new Set(rawJsonFindings.map((finding) => finding.path)).size
  console.log(
    `  route files with raw await request.json() reads: ${rawJsonFiles} (baseline ${BOUNDARY_POLICY_BASELINE.rawJsonReads})`
  )
  console.log(`  route raw await request.json() reads (callsites): ${rawJsonFindings.length}`)
  console.log(`  route raw await request.json() annotated exemptions: ${rawJsonExemptions}`)
  console.log(
    `  contract untyped response schemas (z.unknown / z.object({}).passthrough / z.record): ${untypedResponseFindings.length}`
  )
  console.log(`  contract untyped response annotated exemptions: ${untypedResponseExemptions}`)
  console.log(`  audit annotations missing reason: ${annotationsMissingReason.length}`)

  console.log('  raw fetch examples:')
  for (const finding of rawFetchFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }
  if (rawFetchFindings.length > 25) {
    console.log(`    ... ${rawFetchFindings.length - 25} more`)
  }

  console.log('  same-origin /api/ fetch examples:')
  for (const finding of sameOriginApiFetchFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }
  if (sameOriginApiFetchFindings.length > 25) {
    console.log(`    ... ${sameOriginApiFetchFindings.length - 25} more`)
  }

  console.log('  double-cast examples:')
  for (const finding of doubleCastFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }
  if (doubleCastFindings.length > 25) {
    console.log(`    ... ${doubleCastFindings.length - 25} more`)
  }

  console.log('  raw await request.json() examples:')
  for (const finding of rawJsonFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }
  if (rawJsonFindings.length > 25) {
    console.log(`    ... ${rawJsonFindings.length - 25} more`)
  }

  console.log('  untyped response schema examples:')
  for (const finding of untypedResponseFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }
  if (untypedResponseFindings.length > 25) {
    console.log(`    ... ${untypedResponseFindings.length - 25} more`)
  }

  console.log('  annotations missing reason (must be 0 for --enforce-boundary-baseline):')
  for (const finding of annotationsMissingReason.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} (${finding.kind})`)
  }
  if (annotationsMissingReason.length > 25) {
    console.log(`    ... ${annotationsMissingReason.length - 25} more`)
  }

  console.log(
    '  annotation forms: `// boundary-raw-fetch: <reason>` (raw fetch in client hook OR same-origin /api/ fetch outside an API route handler), `// double-cast-allowed: <reason>` (double-cast), `// boundary-raw-json: <reason>` (raw request.json read), `// untyped-response: <reason>` (z.unknown() / z.object({}).passthrough() / z.record(z.string(), z.unknown()) response schema)'
  )
}

function printBoundaryContractDrift(
  routeAudits: RouteAudit[],
  queryHookAudits: QueryHookAudit[],
  sameOriginApiFetchFindings: SameOriginApiFetchFinding[],
  untypedResponseFindings: UntypedResponseFinding[],
  ratchetedMetrics: BoundaryPolicyMetric[],
  printOnlyMetrics: PrintOnlyBoundaryPolicyMetric[]
) {
  const zodImportRoutes = routeAudits.filter((audit) => audit.hasZodImport)
  const localSchemaRoutes = routeAudits.filter((audit) => audit.schemaConstructorCount > 0)
  const zodErrorRoutes = routeAudits.filter((audit) => audit.hasZodErrorReference)
  const zodImportQueryHooks = queryHookAudits.filter((audit) => audit.hasZodImport)
  const localSchemaQueryHooks = queryHookAudits.filter((audit) => audit.schemaConstructorCount > 0)
  const adHocWireTypes = queryHookAudits.flatMap((audit) => audit.adHocWireTypes)
  const sameOriginApiFetchFiles = [
    ...new Set(sameOriginApiFetchFindings.map((finding) => finding.path)),
  ].sort()

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

  console.log('  apps/sim same-origin /api/ fetch file examples:')
  for (const filePath of sameOriginApiFetchFiles.slice(0, 25)) {
    console.log(`    ${filePath}`)
  }

  if (sameOriginApiFetchFiles.length > 25) {
    console.log(`    ... ${sameOriginApiFetchFiles.length - 25} more`)
  }

  console.log('  contract untyped response schema examples:')
  for (const finding of untypedResponseFindings.slice(0, 25)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.preview}`)
  }

  if (untypedResponseFindings.length > 25) {
    console.log(`    ... ${untypedResponseFindings.length - 25} more`)
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
  const rawJsonFindings: RawJsonFinding[] = []
  const annotationsMissingReason: AnnotationMissingReasonFinding[] = []
  let rawJsonExemptions = 0

  for (const filePath of routeFiles) {
    const content = await readFile(filePath, 'utf8')
    audits.push(auditRoute(filePath, content))

    const rawJson = findRawJsonFindings(filePath, content)
    rawJsonFindings.push(...rawJson.findings)
    rawJsonExemptions += rawJson.exemptions
    annotationsMissingReason.push(...rawJson.missingReasons)
  }
  const queryHookAudits = await auditQueryHooks()

  const sourceFiles = await walkAllSourceFiles(ROOT, true)
  const rawFetchFindings: RawFetchFinding[] = []
  const sameOriginApiFetchFindings: SameOriginApiFetchFinding[] = []
  const doubleCastFindings: DoubleCastFinding[] = []
  let rawFetchExemptions = 0
  let sameOriginApiFetchExemptions = 0
  let doubleCastExemptions = 0

  const appsSimRoot = path.join(ROOT, 'apps/sim')

  for (const filePath of sourceFiles) {
    const content = await readFile(filePath, 'utf8')
    const normalized = filePath.replace(/\\/g, '/')

    if (isClientHookFile(filePath)) {
      const rawFetch = findRawFetchFindings(filePath, content)
      rawFetchFindings.push(...rawFetch.findings)
      rawFetchExemptions += rawFetch.exemptions
      annotationsMissingReason.push(...rawFetch.missingReasons)
    }

    if (
      normalized.startsWith(`${appsSimRoot}/`) &&
      !isApiRouteHandler(filePath) &&
      filePath !== path.join(ROOT, 'scripts', 'check-api-validation-contracts.ts')
    ) {
      const sameOrigin = findSameOriginApiFetchFindings(filePath, content)
      sameOriginApiFetchFindings.push(...sameOrigin.findings)
      sameOriginApiFetchExemptions += sameOrigin.exemptions
      annotationsMissingReason.push(...sameOrigin.missingReasons)
    }

    const doubleCast = findDoubleCastFindings(filePath, content)
    doubleCastFindings.push(...doubleCast.findings)
    doubleCastExemptions += doubleCast.exemptions
    annotationsMissingReason.push(...doubleCast.missingReasons)
  }

  const contractFiles = await walk(CONTRACTS_DIR, (fileName) => /\.ts$/.test(fileName))
  const untypedResponseFindings: UntypedResponseFinding[] = []
  let untypedResponseExemptions = 0

  for (const filePath of contractFiles) {
    const content = await readFile(filePath, 'utf8')
    const untyped = findUntypedResponseFindings(filePath, content)
    untypedResponseFindings.push(...untyped.findings)
    untypedResponseExemptions += untyped.exemptions
    annotationsMissingReason.push(...untyped.missingReasons)
  }

  const { ratchetedMetrics, printOnlyMetrics } = buildBoundaryPolicyMetrics(
    audits,
    queryHookAudits,
    { findings: rawFetchFindings, exemptions: rawFetchExemptions },
    {
      findings: sameOriginApiFetchFindings,
      exemptions: sameOriginApiFetchExemptions,
    },
    { findings: doubleCastFindings, exemptions: doubleCastExemptions },
    { findings: rawJsonFindings, exemptions: rawJsonExemptions },
    { findings: untypedResponseFindings, exemptions: untypedResponseExemptions },
    annotationsMissingReason
  )

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
  printBoundaryContractDrift(
    audits,
    queryHookAudits,
    sameOriginApiFetchFindings,
    untypedResponseFindings,
    ratchetedMetrics,
    printOnlyMetrics
  )
  printRawFetchAndDoubleCastMetrics(
    rawFetchFindings,
    sameOriginApiFetchFindings,
    doubleCastFindings,
    rawJsonFindings,
    untypedResponseFindings,
    annotationsMissingReason,
    rawFetchExemptions,
    sameOriginApiFetchExemptions,
    doubleCastExemptions,
    rawJsonExemptions,
    untypedResponseExemptions
  )

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
