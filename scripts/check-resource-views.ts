#!/usr/bin/env bun
/**
 * Guards the resource-view abstraction: ONE view per resource, many consumers,
 * NO wrappers.
 *
 * A "resource" is a thing a workspace holds that can also be shared: a file, a
 * table, an interface, a knowledge base, a log, a scheduled task. A resource
 * that has a canonical view has exactly one, under
 * `apps/sim/components/resources/<unit>/`, and it is mounted against exactly
 * three axes from `apps/sim/resources/`:
 *
 *   source  — where the data comes from, and by what address (workspace|share)
 *   grants  — what this viewer may do (write / run)
 *   host    — who owns the URL, the router, the document frame (page|panel|public)
 *
 * Consumers CONSTRUCT those three values and MOUNT the view. They do not wrap
 * it, do not reach past its barrel, and do not invent a fourth spelling for
 * "this one is read-only" or "this one is embedded".
 *
 * A resource kind with no canonical view yet (table, knowledge, log, schedule)
 * is simply absent from `CANONICAL_UNITS`. That is the correct state for an
 * unmigrated kind — it needs no marker, no flag, and no placeholder entry.
 *
 * Rules enforced:
 *
 *   R1a wrapper       a component whose whole job is forwarding its props into
 *                     a canonical view (`{...props}` / repeated identity attrs)
 *   R1b shadow name   `Embedded*` / `Mini*` / `ReadOnly*` + a resource noun —
 *                     a per-consumer fork announced in the name
 *   R2  internals     importing `@/components/resources/<unit>/<deep>` from
 *                     outside that unit instead of its barrel
 *   R3a public tree   an anonymous surface (`app/f`, `app/i`, `(landing)`, …)
 *                     importing `@/app/workspace/[workspaceId]/**`
 *   R3b cross tree    any file outside `app/workspace/` doing the same
 *   R4a mount props   a capability/chrome/addressing attribute outside the
 *                     sanctioned set at a canonical-view mount site
 *   R4b view props    the same, DECLARED on a canonical view's own props type
 *   R5  token-as-id   `workspaceId={token}` — a share token laundered through a
 *                     workspace-shaped slot
 *   R6  context leak  `useRouter` / `useParams` / nuqs / permission context read
 *                     inside a canonical unit (that is the host's job)
 *   R7  server safety `'use client'` inside `apps/sim/resources/**`, which a
 *                     Server Component imports to build a share source
 *
 * Escape hatch (reason required, matching the repo's `// boundary-*:` family):
 *   // boundary-resource-wrapper:  <reason>
 *   // boundary-resource-internal: <reason>
 *   // boundary-resource-tree:     <reason>
 *   // boundary-resource-prop:     <reason>
 * placed on the line directly above the offending mount / import / attribute
 * (up to three non-empty comment lines of extra context are tolerated above it).
 *
 * Usage:
 *   bun run scripts/check-resource-views.ts                            # report
 *   bun run scripts/check-resource-views.ts --check                    # CI gate
 *   bun run scripts/check-resource-views.ts --check --enforce-resource-baseline
 *   bun run scripts/check-resource-views.ts --list-cross-tree          # verbose
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_DIR = path.join(ROOT, 'apps/sim')

/**
 * Ratcheted counters. Every entry may go DOWN freely and may never go UP. Lower
 * the number in the same PR that removes the last offender; never raise one to
 * make a build green.
 *
 * Measured against the working tree after the file and interface resources were
 * migrated onto the three axes, so every remaining number names real work.
 */
const RESOURCE_POLICY_BASELINE = {
  /**
   * R1a — files that mount a canonical view and only forward props into it.
   * At its floor: the repo has no passthrough wrapper, so the FIRST one anyone
   * writes fails the build.
   */
  wrapperMounts: 0,
  /**
   * R1b — components whose NAME announces a per-consumer fork. 11 of the 12 are
   * the mothership panel's `Embedded*` tab chrome for kinds that have no
   * canonical view yet (workflow, folder, scheduled task, log, knowledge base);
   * the last is a landing-page marketing mock. Every one drops off as its kind
   * gets a real view.
   */
  shadowNamedComponents: 12,
  /**
   * R2 — imports that reach past a unit barrel. At its floor: the three
   * legitimate deep imports are all `lazy()` code-split points, listed in
   * `INTERNAL_IMPORT_ALLOWLIST` with their reasons.
   */
  unitInternalImports: 0,
  /**
   * R3a — anonymous surfaces importing the authenticated route tree, by file.
   * The resource surfaces (`app/f`, `app/i`, `app/(interfaces)`, `app/(shared)`,
   * public API routes) are all at 0. The 3 remaining are `(landing)/pricing`
   * importing the upgrade comparison data — the same structural smell, nothing
   * to do with resources, and it ratchets to 0 when that data moves to `lib/`.
   */
  publicSurfaceWorkspaceImports: 3,
  /**
   * R3b — any file outside `app/workspace/` importing `@/app/workspace/[workspaceId]/**`.
   * Lowered as `ActionRow` and then `AnchoredContextMenu` moved to `components/`,
   * which is where a component with consumers on both sides of the route tree
   * belongs. The second move also closed a real hole: `file-view` is mounted by
   * `app/f/[token]` for anonymous visitors, and with no `sideEffects: false` its
   * import of the workspace barrel pulled that whole tree into the public chunk.
   */
  crossTreeWorkspaceImports: 30,
  /** R4a — unsanctioned capability/chrome attributes at a canonical-view mount. */
  viewPropVocabularyViolations: 0,
  /** R4b — unsanctioned capability/chrome props declared on a canonical view's props type. */
  viewPropDeclarations: 0,
  /** R5 — a share token passed through a `workspaceId`-shaped prop or field. */
  tokenAsWorkspaceId: 0,
  /**
   * R6 — route/permission context read inside a canonical unit. At its floor:
   * addressing comes from `source.hrefFor` and the move itself from the host's
   * `onNavigate`, so a unit needs no router of its own. The first one anyone
   * reintroduces fails the build.
   */
  unitContextLeaks: 0,
  /** R7 — `'use client'` inside the server-importable axis layer. */
  contractClientDirectives: 0,
  /** All rules — annotations present but with an empty reason. */
  annotationsMissingReason: 0,
} as const

/**
 * The canonical units. `root` is the ONLY directory allowed to define the unit;
 * `barrel` is the ONLY specifier consumers may import; `views` are the exported
 * component names whose mount sites R1a and R4a police.
 *
 * `kind` is set when the unit IS a resource kind's view. A kind that has no
 * canonical view yet does not appear here at all.
 */
interface CanonicalUnit {
  readonly barrel: string
  readonly root: string
  readonly views: readonly string[]
  readonly kind?: string
}

const CANONICAL_UNITS: readonly CanonicalUnit[] = [
  {
    barrel: '@/components/resources/file-view',
    root: 'apps/sim/components/resources/file-view',
    views: ['FileView'],
    kind: 'file',
  },
  {
    barrel: '@/components/resources/interface-view',
    root: 'apps/sim/components/resources/interface-view',
    views: ['InterfaceView'],
    kind: 'interface',
  },
  {
    barrel: '@/components/resources/resource-provider',
    root: 'apps/sim/components/resources/resource-provider',
    views: ['ResourceProvider'],
  },
  {
    barrel: '@/components/resources/resource-empty-state',
    root: 'apps/sim/components/resources/resource-empty-state',
    views: ['ResourceEmptyState'],
  },
]

/** Every resource kind, mirroring `apps/sim/resources/kinds.ts`. */
const RESOURCE_KINDS = ['file', 'table', 'interface', 'knowledge', 'log', 'schedule'] as const

/** The three-axis layer. Pure TypeScript, server-importable, no JSX. */
const RESOURCE_AXIS_ROOT = 'apps/sim/resources'

const CANONICAL_VIEW_NAMES = new Set(CANONICAL_UNITS.flatMap((unit) => unit.views))

/**
 * Surfaces reachable without a workspace session. These may never import
 * `@/app/workspace/[workspaceId]/**`: that tree is nested under a dynamic
 * `[workspaceId]` segment, which is exactly how `workspaceId: string` came to
 * read as natural on components anonymous visitors mount with a share token.
 */
const PUBLIC_SURFACE_PATTERNS: readonly RegExp[] = [
  /^apps\/sim\/app\/f\//,
  /^apps\/sim\/app\/i\//,
  /^apps\/sim\/app\/\(interfaces\)\//,
  /^apps\/sim\/app\/\(landing\)\//,
  /^apps\/sim\/app\/\(shared\)\//,
  /^apps\/sim\/app\/api\/(?:.*\/)?public\//,
]

/**
 * The ONLY attributes a canonical view accepts: the three axes, the React
 * intrinsics, and the documented per-view extras.
 *
 * Every extra below is documented in `.claude/rules/sim-resource-views.md` and
 * carries a TSDoc reason at its declaration. Adding to this set is a design
 * decision, not a fix for a failing build.
 */
const SANCTIONED_VIEW_PROPS = new Set([
  'source',
  'grants',
  'host',
  'key',
  'ref',
  'className',
  'children',
  /**
   * FileView. `readOnly` is a rendering mode, not a capability: it means "no
   * editor at all" (text renders through the preview panel), whereas
   * `!grants.write` means "a disabled editor" (Monaco read-only, syntax
   * highlighting, split preview). Neither axis reproduces it.
   */
  'readOnly',
  'previewMode',
  'autoFocus',
  'saveRef',
  'discardRef',
  'onDirtyChange',
  'onSaveStatusChange',
  /** FileView. The five agent-streaming props, collapsed into one object. */
  'streaming',
  /** InterfaceView. Every authoring mutation, collapsed into one object. */
  'editing',
  /**
   * The router half of the `host` axis. A view must not hold a `useRouter()` of
   * its own — that silently assumes a workspace route, which is true in two of
   * the three hosts — so the host that owns a router supplies one. Omitting it
   * (a `'public'` host) makes navigation inert by construction.
   */
  'onNavigate',
])

/**
 * Capability / chrome / addressing spellings the three axes replace. Flagged at
 * a canonical-view mount site (R4a) and when declared on a canonical view's own
 * props type (R4b).
 *
 *   capability  canEdit / canRun / canAdmin / canDelete / disableEdit / …
 *   chrome      embedded / isEmbedded / compact / minimal
 *   address     workspaceId / token / contentSource / isPublic / isShared
 *   streaming   isAgentEditing / streamingContent / streamIsIncremental / …
 */
const BANNED_AXIS_PROPS = new Set([
  'embedded',
  'isEmbedded',
  'compact',
  'minimal',
  'canEdit',
  'canRun',
  'canAdmin',
  'canDelete',
  'disableEdit',
  'disableInsert',
  'disableDelete',
  'disableTagging',
  'workflowReadOnly',
  'isSnapshotView',
  'isPublic',
  'isShared',
  'isPreview',
  'workspaceId',
  'token',
  'contentSource',
  'isAgentEditing',
  'streamingContent',
  'streamIsIncremental',
  'disableStreamingAutoScroll',
  'previewContextKey',
])

/**
 * Components whose NAME announces a per-consumer fork of a resource surface.
 * `EmbeddedTableActions`, `MiniTablePanel` — each is a place a consumer
 * re-solved a problem the resource should solve once.
 *
 * `Public*` is deliberately absent: `PublicFileView` / `PublicInterfaceView` are
 * the share pages' own shells, and they construct the axes and mount the
 * canonical view. That is the shape this rule wants, not the shape it bans.
 */
const SHADOW_NAME_PATTERN =
  /(?:^|\n)\s*(?:export\s+)?(?:function|const)\s+((?:Embedded|Wrapped|ReadOnly|Readonly|Mini|Simple|Basic|Inline)(?:File|Files|Table|Tables|Interface|Knowledge|KnowledgeBase|Log|Logs|Folder|ScheduledTask|Schedule|Workflow|Resource)\w*)\b/g

/** Context a canonical unit may not read — that is the host's and source's job. */
const UNIT_CONTEXT_LEAK_PATTERN =
  /\b(useRouter|useParams|useSearchParams|usePathname|useQueryState|useQueryStates|useUserPermissionsContext)\s*\(/g

const SPREAD_PROPS_PATTERN = /^\{\s*\.\.\.\s*(?:props|rest|restProps)\b/

/**
 * Evidence that a file CONSTRUCTS an axis value rather than merely relaying one.
 * A file that does this is a consumer doing the work the abstraction asks of it,
 * never a wrapper.
 *
 * The inline-literal alternative is written as `grants={{` (two braces) so that
 * a plain passthrough `grants={grants}` does NOT read as construction — that
 * mistake would make the wrapper rule silently inert.
 */
const AXIS_CONSTRUCTOR_PATTERN =
  /\b(?:workspaceSource|shareSource|grantsFromPermissions|grantsForShare|useResource|useOptionalResource|hostOwnsUrl)\s*\(|\b(?:source|grants|host)\s*=\s*\{\{|\bconst\s+(?:source|grants|host)\b/

const TOKEN_AS_WORKSPACE_ID_PATTERN =
  /\bworkspaceId\s*(?:=\s*\{|:)\s*(?:[\w.]*\btoken\b[\w.]*|[^,\n}]*\?\s*[^:]*:\s*[\w.]*\btoken\b)/g
const USE_CLIENT_PATTERN = /^\s*(?:'use client'|"use client")\s*$/m
const PROP_MEMBER_PATTERN = /(?:^|\n)\s+(?:readonly\s+)?([a-zA-Z_]\w*)\??\s*:/g

const ANNOTATION_PREFIXES = {
  wrapper: '// boundary-resource-wrapper:',
  internal: '// boundary-resource-internal:',
  tree: '// boundary-resource-tree:',
  prop: '// boundary-resource-prop:',
} as const

type AnnotationKind = keyof typeof ANNOTATION_PREFIXES

/**
 * Deep imports that must not go through a barrel, keyed by importer. Structural
 * exceptions live here rather than as per-line annotations, following the
 * `INDIRECT_ZOD_ROUTES` model in `scripts/check-api-validation-contracts.ts`.
 *
 * Anything not listed is a finding, so an allowlisted file cannot quietly grow
 * a second deep import.
 */
interface InternalImportException {
  readonly specifier: string
  readonly reason: string
}

const INTERNAL_IMPORT_ALLOWLIST: ReadonlyMap<string, readonly InternalImportException[]> = new Map([
  [
    'apps/sim/components/resources/interface-view/components/module-renderer/components/file-module/file-module.tsx',
    [
      {
        specifier: '@/components/resources/file-view/file-view',
        reason:
          'lazy() split point — routing through the barrel re-attaches pdf.js/docx/xlsx/pptx to the interfaces chunk',
      },
    ],
  ],
  [
    'apps/sim/app/workspace/[workspaceId]/skills/components/skill-modal/skill-modal.tsx',
    [
      {
        specifier:
          '@/components/resources/file-view/components/rich-markdown-editor/rich-markdown-field',
        reason: 'lazy() split point — keeps the ProseMirror editor out of the skills chunk',
      },
    ],
  ],
  [
    'apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/version-description-modal.tsx',
    [
      {
        specifier:
          '@/components/resources/file-view/components/rich-markdown-editor/rich-markdown-field',
        reason: 'lazy() split point — keeps the ProseMirror editor out of the workflow chunk',
      },
    ],
  ],
])

const CROSS_TREE_ALLOWLIST = new Set<string>([
  // (empty) — every anonymous-surface import of the workspace tree is a finding.
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', '__tests__'])
const TEST_FILE_PATTERN = /(?:\.test|\.spec)\.(?:ts|tsx)$/

interface Finding {
  path: string
  line: number
  detail: string
  preview: string
}

interface AnnotationMissingReasonFinding {
  path: string
  line: number
  kind: AnnotationKind
}

interface AnnotationResult {
  allowed: boolean
  missingReason: boolean
}

interface RuleSummary {
  findings: Finding[]
  exemptions: number
  missingReasons: AnnotationMissingReasonFinding[]
}

type ResourcePolicyKey = keyof typeof RESOURCE_POLICY_BASELINE

/**
 * Counters `--check` fails on without `--enforce-resource-baseline`. Each is
 * either at its floor or at a number no new code has any business raising: a
 * wrapper, an import past a barrel, a token in a `workspaceId` slot, a
 * `useRouter` inside a view, or a dangling annotation is never an inherited
 * fact — it is something this PR added.
 *
 * The counters that measure work still to do (`shadowNamedComponents`,
 * `crossTreeWorkspaceImports`) report until `--enforce-resource-baseline` is
 * passed, so the check ratchets rather than failing the world.
 */
const DAY_ONE_GATES = new Set<ResourcePolicyKey>([
  'wrapperMounts',
  'unitInternalImports',
  'publicSurfaceWorkspaceImports',
  'viewPropVocabularyViolations',
  'viewPropDeclarations',
  'tokenAsWorkspaceId',
  'unitContextLeaks',
  'contractClientDirectives',
  'annotationsMissingReason',
])

interface RatchetedMetric {
  key: ResourcePolicyKey
  label: string
  current: number
}

interface PrintOnlyMetric {
  label: string
  current: number
}

function emptySummary(): RuleSummary {
  return { findings: [], exemptions: 0, missingReasons: [] }
}

function mergeSummary(target: RuleSummary, source: RuleSummary): void {
  target.findings.push(...source.findings)
  target.exemptions += source.exemptions
  target.missingReasons.push(...source.missingReasons)
}

async function walkSourceTree(dir: string, results: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkSourceTree(fullPath, results)
      continue
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    if (TEST_FILE_PATTERN.test(entry.name)) continue

    results.push(fullPath)
  }
}

function lineNumberForIndex(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

function buildPreview(line: string): string {
  return line.trim().slice(0, 160)
}

/**
 * Inspects up to three consecutive non-empty preceding lines for an opt-out
 * annotation of the given kind. Allowed only when the prefix is followed by a
 * non-empty reason; a bare prefix is reported via `missingReason` and still
 * counts as a finding, so an empty annotation can never buy silence.
 *
 * Identical semantics to `extractAnnotation` in
 * `scripts/check-api-validation-contracts.ts` — deliberately, so authors learn
 * one placement rule for the whole repo.
 */
function extractAnnotation(
  content: string,
  lineIndex: number,
  kind: AnnotationKind
): AnnotationResult {
  const prefix = ANNOTATION_PREFIXES[kind]
  const lines = content.split('\n')
  let inspected = 0

  for (let i = lineIndex - 1; i >= 0 && inspected < 3; i -= 1) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed.length === 0) continue
    inspected += 1

    if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      return { allowed: false, missingReason: false }
    }

    const prefixIndex = trimmed.indexOf(prefix)
    if (prefixIndex === -1) continue

    const reason = trimmed.slice(prefixIndex + prefix.length).trim()
    if (reason.length === 0) return { allowed: false, missingReason: true }
    return { allowed: true, missingReason: false }
  }

  return { allowed: false, missingReason: false }
}

function record(
  summary: RuleSummary,
  content: string,
  relativePath: string,
  index: number,
  kind: AnnotationKind,
  detail: string
): void {
  const lineNumber = lineNumberForIndex(content, index)
  const line = content.split('\n')[lineNumber - 1] ?? ''
  const annotation = extractAnnotation(content, lineNumber - 1, kind)

  if (annotation.missingReason) {
    summary.missingReasons.push({ path: relativePath, line: lineNumber, kind })
    summary.findings.push({
      path: relativePath,
      line: lineNumber,
      detail,
      preview: buildPreview(line),
    })
    return
  }
  if (annotation.allowed) {
    summary.exemptions += 1
    return
  }
  summary.findings.push({
    path: relativePath,
    line: lineNumber,
    detail,
    preview: buildPreview(line),
  })
}

interface ImportInfo {
  index: number
  specifier: string
}

/** Parse `import ... from '...'` and `import('...')`, including multi-line clauses. */
function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = []

  /**
   * The index points at the `import` keyword, not at the newline the pattern
   * consumed to anchor it. Anchoring on the newline would report every finding
   * one line high and start the annotation scan one line too early, silently
   * swallowing a `// boundary-resource-*` comment placed directly above.
   */
  const staticPattern = /(?:^|\n)\s*import\s+[\s\S]{0,600}?\s+from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = staticPattern.exec(content)) !== null) {
    imports.push({
      index: match.index + match[0].indexOf('import'),
      specifier: match[1] ?? '',
    })
  }

  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicPattern.exec(content)) !== null) {
    imports.push({ index: match.index, specifier: match[1] ?? '' })
  }

  return imports.sort((a, b) => a.index - b.index)
}

interface OpenTag {
  index: number
  text: string
}

/**
 * Reads the open tag of a JSX element starting at `<Name`, balancing braces and
 * skipping string literals so that `title={cond ? '>' : '<'}` does not terminate
 * the scan early.
 */
function readOpenTag(content: string, startIndex: number): OpenTag | null {
  let depth = 0
  let quote: string | null = null

  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i]

    if (quote) {
      if (char === '\\') {
        i += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      continue
    }
    if (char === '>' && depth === 0) {
      return { index: startIndex, text: content.slice(startIndex, i + 1) }
    }
  }

  return null
}

/** Reads a balanced `{ … }` body starting at `openIndex` (the `{` itself). */
function readBracedBody(content: string, openIndex: number): string | null {
  let depth = 0
  for (let i = openIndex; i < content.length; i += 1) {
    const char = content[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return content.slice(openIndex, i + 1)
    }
  }
  return null
}

interface MountSite {
  view: string
  index: number
  attributes: string[]
  identityAttributes: number
  spreadsProps: boolean
}

interface TagAttributes {
  names: string[]
  identityAttributes: number
  spreadsProps: boolean
}

/**
 * Attribute names declared directly on a JSX open tag.
 *
 * Written as a scanner rather than a regex because attribute VALUES are
 * arbitrary expressions: `streaming={{ isAgentEditing, contextKey }}` would
 * otherwise read as three attributes named after the axes those keys replaced —
 * exactly the false positive that would make R4a report the correct shape as a
 * violation. Values are skipped wholesale; only names at attribute position
 * count.
 */
function parseTagAttributes(body: string): TagAttributes {
  const names: string[] = []
  let identityAttributes = 0
  let spreadsProps = false
  let i = 0

  const skipBalanced = (open: string, close: string): string => {
    const start = i
    let depth = 0
    let quote: string | null = null
    for (; i < body.length; i += 1) {
      const char = body[i]
      if (quote) {
        if (char === '\\') i += 1
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === open) depth += 1
      else if (char === close) {
        depth -= 1
        if (depth === 0) {
          i += 1
          return body.slice(start, i)
        }
      }
    }
    return body.slice(start)
  }

  while (i < body.length) {
    const char = body[i]
    if (char === undefined) break
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    if (char === '>' || char === '/') break
    if (char === '{') {
      const spread = skipBalanced('{', '}')
      if (SPREAD_PROPS_PATTERN.test(spread)) spreadsProps = true
      continue
    }

    const nameMatch = /^[a-zA-Z_][\w-]*/.exec(body.slice(i))
    if (!nameMatch) {
      i += 1
      continue
    }
    const name = nameMatch[0]
    names.push(name)
    i += name.length

    while (i < body.length && /\s/.test(body[i] ?? '')) i += 1
    if (body[i] !== '=') continue
    i += 1
    while (i < body.length && /\s/.test(body[i] ?? '')) i += 1

    const valueStart = body[i]
    if (valueStart === '{') {
      if (skipBalanced('{', '}') === `{${name}}`) identityAttributes += 1
    } else if (valueStart === '"' || valueStart === "'") {
      i += 1
      while (i < body.length && body[i] !== valueStart) {
        if (body[i] === '\\') i += 1
        i += 1
      }
      i += 1
    }
  }

  return { names, identityAttributes, spreadsProps }
}

/** Every canonical-view JSX mount in a file, with its attribute names. */
function findMountSites(content: string): MountSite[] {
  const sites: MountSite[] = []

  for (const view of CANONICAL_VIEW_NAMES) {
    const pattern = new RegExp(`<${view}(?=[\\s/>])`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const tag = readOpenTag(content, match.index)
      if (!tag) continue

      const attributes = parseTagAttributes(tag.text.slice(view.length + 1))
      sites.push({
        view,
        index: match.index,
        attributes: attributes.names,
        identityAttributes: attributes.identityAttributes,
        spreadsProps: attributes.spreadsProps,
      })
    }
  }

  return sites.sort((a, b) => a.index - b.index)
}

function countComponentTags(content: string): number {
  return [...content.matchAll(/<([A-Z]\w*)(?=[\s/>])/g)].length
}

function unitForPath(relativePath: string): CanonicalUnit | null {
  return CANONICAL_UNITS.find((unit) => relativePath.startsWith(`${unit.root}/`)) ?? null
}

function isPublicSurface(relativePath: string): boolean {
  return PUBLIC_SURFACE_PATTERNS.some((pattern) => pattern.test(relativePath))
}

/**
 * R1a — wrapper detection.
 *
 * A wrapper is a file whose entire contribution is forwarding props into a
 * canonical view: exactly one mount, no axis value constructed anywhere in the
 * file, and the mount either spreads `{...props}` or repeats at least two
 * identity attributes (`grants={grants}`). The component-tag ceiling keeps real
 * route pages and dispatchers — which mount a view alongside genuine UI — out.
 *
 * The fix is never "delete the file": it is to construct the axes the wrapper
 * was hiding (`workspaceSource(...)`, `grantsForShare(...)`, a `host` literal)
 * and mount the view directly at the consumer.
 */
function auditWrapper(relativePath: string, content: string, mounts: MountSite[]): RuleSummary {
  const summary = emptySummary()
  if (unitForPath(relativePath)) return summary
  if (mounts.length !== 1) return summary
  if (AXIS_CONSTRUCTOR_PATTERN.test(content)) return summary
  if (countComponentTags(content) > 3) return summary

  const mount = mounts[0]
  if (!mount) return summary
  if (!mount.spreadsProps && mount.identityAttributes < 2) return summary

  record(
    summary,
    content,
    relativePath,
    mount.index,
    'wrapper',
    `wraps <${mount.view}/> (${mount.spreadsProps ? '{...props} spread' : `${mount.identityAttributes} identity props`}) without constructing source/grants/host`
  )
  return summary
}

/** R1b — components named after a per-consumer fork of a resource surface. */
function auditShadowNames(relativePath: string, content: string): Finding[] {
  const findings: Finding[] = []
  SHADOW_NAME_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SHADOW_NAME_PATTERN.exec(content)) !== null) {
    const name = match[1]
    if (!name) continue
    const lineNumber = lineNumberForIndex(content, match.index)
    findings.push({
      path: relativePath,
      line: lineNumber,
      detail: name,
      preview: buildPreview(content.split('\n')[lineNumber - 1] ?? ''),
    })
  }
  return findings
}

/**
 * R2 — internals import.
 *
 * A unit publishes exactly one entry point: its barrel. Reaching past it binds
 * the consumer to the unit's private file layout, which is how a consumer ends
 * up re-solving a problem the unit already solves.
 */
function auditInternalImports(
  relativePath: string,
  content: string,
  imports: readonly ImportInfo[]
): RuleSummary {
  const summary = emptySummary()
  const allowed = INTERNAL_IMPORT_ALLOWLIST.get(relativePath) ?? []
  const owningUnit = unitForPath(relativePath)

  for (const imp of imports) {
    const unit = CANONICAL_UNITS.find((candidate) =>
      imp.specifier.startsWith(`${candidate.barrel}/`)
    )
    if (!unit) continue
    if (owningUnit && unit.root === owningUnit.root) continue
    if (allowed.some((exception) => exception.specifier === imp.specifier)) continue

    record(
      summary,
      content,
      relativePath,
      imp.index,
      'internal',
      `imports '${imp.specifier}' instead of the '${unit.barrel}' barrel`
    )
  }

  return summary
}

/**
 * R3 — cross-tree import.
 *
 * `apps/sim/app/workspace/[workspaceId]/**` sits under a dynamic workspace
 * segment. A shared unit living there is why `workspaceId: string` looked
 * natural on a component two anonymous consumers mounted with a SHARE TOKEN.
 * Shared units belong in `apps/sim/components/resources/**`.
 */
function auditCrossTree(
  relativePath: string,
  content: string,
  imports: readonly ImportInfo[]
): { publicSurface: RuleSummary; all: Finding[] } {
  const publicSurface = emptySummary()
  const all: Finding[] = []
  if (relativePath.startsWith('apps/sim/app/workspace/')) return { publicSurface, all }
  if (CROSS_TREE_ALLOWLIST.has(relativePath)) return { publicSurface, all }

  const anonymous = isPublicSurface(relativePath)

  for (const imp of imports) {
    if (!imp.specifier.startsWith('@/app/workspace/[workspaceId]/')) continue

    const lineNumber = lineNumberForIndex(content, imp.index)
    all.push({
      path: relativePath,
      line: lineNumber,
      detail: imp.specifier,
      preview: buildPreview(content.split('\n')[lineNumber - 1] ?? ''),
    })

    if (!anonymous) continue
    record(
      publicSurface,
      content,
      relativePath,
      imp.index,
      'tree',
      `anonymous surface imports '${imp.specifier}' from the authenticated route tree`
    )
  }

  return { publicSurface, all }
}

/**
 * R4a — vocabulary at a mount site.
 *
 * Capability, chrome and addressing were historically spelled five ways each:
 * `canEdit` / `readOnly` / `canRun` / `disabled` for what a viewer may do,
 * `embedded` for chrome, `workspaceId` / `token` / `contentSource` for the
 * address. A view takes `source`, `grants`, `host` and its documented extras;
 * any other attribute is a per-consumer spelling being reintroduced.
 */
function auditMountVocabulary(
  relativePath: string,
  content: string,
  mounts: readonly MountSite[]
): RuleSummary {
  const summary = emptySummary()

  for (const mount of mounts) {
    for (const attribute of mount.attributes) {
      if (SANCTIONED_VIEW_PROPS.has(attribute)) continue
      if (!BANNED_AXIS_PROPS.has(attribute)) continue

      record(
        summary,
        content,
        relativePath,
        mount.index,
        'prop',
        `<${mount.view} ${attribute}=…> — express it through source / grants / host`
      )
    }
  }

  return summary
}

/**
 * R4b — vocabulary declared on a canonical view's own props type.
 *
 * The mount-site rule stops a consumer passing `embedded`; this rule stops a
 * view from ever offering it. Scoped to the view's public prop surface
 * (`interface FileViewProps { … }`) — a unit's internal components are free to
 * take whatever the view derives for them from the axes.
 */
function auditViewPropDeclarations(relativePath: string, content: string): RuleSummary {
  const summary = emptySummary()
  const unit = unitForPath(relativePath)
  if (!unit) return summary

  for (const view of unit.views) {
    const declaration = new RegExp(`\\b(?:interface|type)\\s+${view}Props\\b[^{]*\\{`)
    const match = declaration.exec(content)
    if (!match) continue

    const openIndex = match.index + match[0].length - 1
    const body = readBracedBody(content, openIndex)
    if (!body) continue

    PROP_MEMBER_PATTERN.lastIndex = 0
    let member: RegExpExecArray | null
    while ((member = PROP_MEMBER_PATTERN.exec(body)) !== null) {
      const name = member[1]
      if (!name || !BANNED_AXIS_PROPS.has(name)) continue
      if (SANCTIONED_VIEW_PROPS.has(name)) continue

      record(
        summary,
        content,
        relativePath,
        openIndex + member.index,
        'prop',
        `${view}Props declares '${name}' — a view expresses capability through grants and chrome through host, never a per-consumer flag`
      )
    }
  }

  return summary
}

/**
 * R5 — a share token laundered through a `workspaceId`-shaped field.
 *
 * This is the security-relevant one. A token in a `workspaceId` slot lands in
 * the closures of authenticated URL builders and mutation hooks; it is inert
 * only by accident. `ShareSource` declares `workspaceId?: never` so the
 * substitution stops being expressible — this rule catches the places that
 * route around the type.
 */
function auditTokenAsWorkspaceId(relativePath: string, content: string): RuleSummary {
  const summary = emptySummary()
  TOKEN_AS_WORKSPACE_ID_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_AS_WORKSPACE_ID_PATTERN.exec(content)) !== null) {
    record(
      summary,
      content,
      relativePath,
      match.index,
      'prop',
      'share token passed as workspaceId — construct a ShareSource instead'
    )
  }
  return summary
}

/**
 * Whether a line is wholly a comment — a `//` line, or a line inside a block
 * comment as written by this repo's formatter (`/*`, `*`, `*​/`).
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  )
}

/** R6 — a canonical unit reading route or permission context directly. */
function auditUnitContextLeaks(relativePath: string, content: string): Finding[] {
  if (!unitForPath(relativePath)) return []

  const findings: Finding[] = []
  const lines = content.split('\n')
  UNIT_CONTEXT_LEAK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = UNIT_CONTEXT_LEAK_PATTERN.exec(content)) !== null) {
    const lineNumber = lineNumberForIndex(content, match.index)
    /**
     * A comment naming the hook is documentation, not a call. The rule's own
     * TSDoc explains why a unit must not hold a router, and flagging that would
     * make the check punish the code that teaches it.
     */
    if (isCommentLine(lines[lineNumber - 1] ?? '')) continue
    findings.push({
      path: relativePath,
      line: lineNumber,
      detail: `${match[1]}() — the host owns navigation and URL state, the source owns addressing`,
      preview: buildPreview(content.split('\n')[lineNumber - 1] ?? ''),
    })
  }
  return findings
}

/**
 * R7 — `'use client'` inside `apps/sim/resources/**`.
 *
 * Next.js rewrites every export of a `'use client'` module into a client
 * reference in the server bundle, so a `page.tsx` calling one throws at runtime.
 * `app/i/[token]/page.tsx` builds a share source during SSR.
 */
function auditAxisClientDirective(relativePath: string, content: string): Finding[] {
  if (!relativePath.startsWith(`${RESOURCE_AXIS_ROOT}/`)) return []
  if (!USE_CLIENT_PATTERN.test(content)) return []
  return [
    {
      path: relativePath,
      line: lineNumberForIndex(content, content.indexOf('use client')),
      detail: "'use client' in the server-importable axis layer",
      preview: "'use client'",
    },
  ]
}

function printFindings(label: string, findings: readonly Finding[], limit = 25): void {
  console.log(`  ${label}: ${findings.length}`)
  for (const finding of findings.slice(0, limit)) {
    console.log(`    ${finding.path}:${finding.line} ${finding.detail}`)
  }
  if (findings.length > limit) {
    console.log(`    ... ${findings.length - limit} more`)
  }
}

function printRatchetedMetric(metric: RatchetedMetric): void {
  const baseline = RESOURCE_POLICY_BASELINE[metric.key]
  const delta = metric.current - baseline
  const deltaText = delta === 0 ? 'at baseline' : `${delta > 0 ? '+' : ''}${delta} vs baseline`
  console.log(`  ${metric.label}: ${metric.current} (${deltaText})`)
}

function ratchetFailures(metrics: readonly RatchetedMetric[]): string[] {
  return metrics
    .filter((metric) => metric.current > RESOURCE_POLICY_BASELINE[metric.key])
    .map(
      (metric) =>
        `${metric.label} increased from ${RESOURCE_POLICY_BASELINE[metric.key]} to ${metric.current}`
    )
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check')
  const enforceBaseline = process.argv.includes('--enforce-resource-baseline')
  const listCrossTree = process.argv.includes('--list-cross-tree')

  const files: string[] = []
  await walkSourceTree(APP_DIR, files)

  const wrapperSummary = emptySummary()
  const internalSummary = emptySummary()
  const publicTreeSummary = emptySummary()
  const mountPropSummary = emptySummary()
  const viewPropSummary = emptySummary()
  const tokenSummary = emptySummary()

  const shadowNameFindings: Finding[] = []
  const crossTreeFindings: Finding[] = []
  const contextLeakFindings: Finding[] = []
  const axisClientFindings: Finding[] = []

  let totalMounts = 0
  const consumersByView = new Map<string, Set<string>>()

  for (const absolutePath of files) {
    const relativePath = path.relative(ROOT, absolutePath).replace(/\\/g, '/')

    const content = await readFile(absolutePath, 'utf8')
    const imports = parseImports(content)
    const mounts = relativePath.endsWith('.tsx') ? findMountSites(content) : []

    totalMounts += mounts.length
    for (const mount of mounts) {
      const consumers = consumersByView.get(mount.view) ?? new Set<string>()
      consumers.add(relativePath)
      consumersByView.set(mount.view, consumers)
    }

    mergeSummary(wrapperSummary, auditWrapper(relativePath, content, mounts))
    mergeSummary(internalSummary, auditInternalImports(relativePath, content, imports))
    mergeSummary(mountPropSummary, auditMountVocabulary(relativePath, content, mounts))
    mergeSummary(viewPropSummary, auditViewPropDeclarations(relativePath, content))
    mergeSummary(tokenSummary, auditTokenAsWorkspaceId(relativePath, content))

    const crossTree = auditCrossTree(relativePath, content, imports)
    mergeSummary(publicTreeSummary, crossTree.publicSurface)
    crossTreeFindings.push(...crossTree.all)

    shadowNameFindings.push(...auditShadowNames(relativePath, content))
    contextLeakFindings.push(...auditUnitContextLeaks(relativePath, content))
    axisClientFindings.push(...auditAxisClientDirective(relativePath, content))
  }

  const annotationsMissingReason = [
    ...wrapperSummary.missingReasons,
    ...internalSummary.missingReasons,
    ...publicTreeSummary.missingReasons,
    ...mountPropSummary.missingReasons,
    ...viewPropSummary.missingReasons,
    ...tokenSummary.missingReasons,
  ]

  const ratchetedMetrics: RatchetedMetric[] = [
    { key: 'wrapperMounts', label: 'R1a wrapper mounts', current: wrapperSummary.findings.length },
    {
      key: 'shadowNamedComponents',
      label: 'R1b shadow-named components (Embedded*/Mini*/ReadOnly*)',
      current: shadowNameFindings.length,
    },
    {
      key: 'unitInternalImports',
      label: 'R2  imports past a unit barrel',
      current: internalSummary.findings.length,
    },
    {
      key: 'publicSurfaceWorkspaceImports',
      label: 'R3a anonymous surfaces importing the workspace route tree (files)',
      current: new Set(publicTreeSummary.findings.map((finding) => finding.path)).size,
    },
    {
      key: 'crossTreeWorkspaceImports',
      label: 'R3b files outside app/workspace importing @/app/workspace/[workspaceId]/**',
      current: new Set(crossTreeFindings.map((finding) => finding.path)).size,
    },
    {
      key: 'viewPropVocabularyViolations',
      label: 'R4a unsanctioned capability/chrome props at a view mount',
      current: mountPropSummary.findings.length,
    },
    {
      key: 'viewPropDeclarations',
      label: 'R4b unsanctioned capability/chrome props on a view props type',
      current: viewPropSummary.findings.length,
    },
    {
      key: 'tokenAsWorkspaceId',
      label: 'R5  share token passed as workspaceId',
      current: tokenSummary.findings.length,
    },
    {
      key: 'unitContextLeaks',
      label: 'R6  router/params/nuqs/permission reads inside a canonical unit',
      current: contextLeakFindings.length,
    },
    {
      key: 'contractClientDirectives',
      label: "R7  'use client' inside apps/sim/resources/**",
      current: axisClientFindings.length,
    },
    {
      key: 'annotationsMissingReason',
      label: 'audit annotations missing reason',
      current: annotationsMissingReason.length,
    },
  ]

  const printOnlyMetrics: PrintOnlyMetric[] = [
    { label: 'canonical view mount sites', current: totalMounts },
    { label: 'R1a wrapper annotated exemptions', current: wrapperSummary.exemptions },
    { label: 'R2  internal-import annotated exemptions', current: internalSummary.exemptions },
    {
      label: 'R2  internal-import allowlisted deep imports',
      current: INTERNAL_IMPORT_ALLOWLIST.size,
    },
    { label: 'R3  cross-tree annotated exemptions', current: publicTreeSummary.exemptions },
    {
      label: 'R4  prop-vocabulary annotated exemptions',
      current: mountPropSummary.exemptions + viewPropSummary.exemptions,
    },
    { label: 'R5  token-as-workspaceId annotated exemptions', current: tokenSummary.exemptions },
  ]

  const migratedKinds = CANONICAL_UNITS.map((unit) => unit.kind).filter(
    (kind): kind is string => kind !== undefined
  )
  const unmigratedKinds = RESOURCE_KINDS.filter((kind) => !migratedKinds.includes(kind))

  console.log('Resource view audit')
  console.log(`  source files scanned: ${files.length}`)
  console.log(`  canonical units: ${CANONICAL_UNITS.length}`)
  console.log(`  kinds with a canonical view: ${migratedKinds.join(', ')}`)
  console.log(`  kinds with no canonical view yet: ${unmigratedKinds.join(', ')}`)

  console.log('\nConsumers per canonical view (higher is the goal):')
  for (const unit of CANONICAL_UNITS) {
    for (const view of unit.views) {
      console.log(`  ${view.padEnd(20)} consumers=${consumersByView.get(view)?.size ?? 0}`)
    }
  }

  console.log('\nResource policy drift:')
  console.log('  ratcheted metrics:')
  for (const metric of ratchetedMetrics) {
    printRatchetedMetric(metric)
  }
  console.log('  print-only heuristics:')
  for (const metric of printOnlyMetrics) {
    console.log(`  ${metric.label}: ${metric.current}`)
  }
  console.log(
    '  ratchet enforcement: pass --enforce-resource-baseline to fail on any ratcheted increase'
  )
  console.log('  ratchet update: lower RESOURCE_POLICY_BASELINE after reducing a ratcheted count')

  console.log('\nResource policy examples:')
  printFindings('R1a wrapper mounts', wrapperSummary.findings)
  printFindings('R1b shadow-named components', shadowNameFindings)
  printFindings('R2  imports past a unit barrel', internalSummary.findings)
  printFindings('R3a anonymous surface -> workspace tree', publicTreeSummary.findings)
  printFindings(
    'R3b cross-tree workspace imports (pass --list-cross-tree)',
    listCrossTree ? crossTreeFindings : []
  )
  printFindings('R4a unsanctioned props at a mount', mountPropSummary.findings)
  printFindings('R4b unsanctioned props on a view props type', viewPropSummary.findings)
  printFindings('R5  share token as workspaceId', tokenSummary.findings)
  printFindings('R6  context leaks inside a unit', contextLeakFindings)
  printFindings("R7  'use client' in apps/sim/resources", axisClientFindings)
  printFindings(
    'annotations missing reason',
    annotationsMissingReason.map((finding) => ({
      path: finding.path,
      line: finding.line,
      detail: `(${finding.kind})`,
      preview: '',
    }))
  )

  console.log(
    '\n  annotation forms: `// boundary-resource-wrapper: <reason>` (mount a view instead of wrapping it), ' +
      '`// boundary-resource-internal: <reason>` (import the unit barrel), ' +
      '`// boundary-resource-tree: <reason>` (anonymous surface importing the workspace route tree), ' +
      '`// boundary-resource-prop: <reason>` (capability/chrome prop outside source/grants/host)'
  )
  console.log('  rule: .claude/rules/sim-resource-views.md')

  if (!checkOnly) return

  const failures = enforceBaseline
    ? ratchetFailures(ratchetedMetrics)
    : ratchetFailures(ratchetedMetrics.filter((metric) => DAY_ONE_GATES.has(metric.key)))

  if (failures.length > 0) {
    console.error('\nResource view audit failed:')
    for (const failure of failures) {
      console.error(`  - ${failure}`)
    }
    console.error(
      '\n  Fix: construct source/grants/host at the consumer and mount the canonical view.\n' +
        '  Do NOT add a prop to the view, and do NOT wrap it. See .claude/rules/sim-resource-views.md.'
    )
    process.exit(1)
  }

  console.log('\nResource view audit passed.')
}

void main().catch((error) => {
  console.error('Resource view audit failed:', error)
  process.exit(1)
})
