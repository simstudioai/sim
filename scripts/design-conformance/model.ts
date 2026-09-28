import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import type { Route, SourceSummary } from '#design-conformance/source-summary'

export const VERSION = '4.2.0'
export const TOKEN_FILE = 'apps/sim/app/_styles/globals.css'
/** Failed inspection is distinct from an unresolved styling flow. */
export const inspectionFailure = (note: Pick<Note, 'inspection' | 'reason'>) =>
  note.inspection === 'failed'
export const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
export const canonical = (value: unknown): string => JSON.stringify(value)
export interface Atom {
  deferredStyle?: boolean
  pendingRef?: string
  partial?: { expression: string; inputs: string[] }
  forwarded?: Route[]
  reference?: string
  kind: 'class' | 'style' | 'token'
  property: string
  value: string
  line: number
  column: number
  context: string
}
export interface Note {
  inspection?: 'failed'
  relevant?: true
  deferredStyle?: { target: string; slot: string }
  reason: string
  line: number
  context: string
}
export interface Facts {
  artwork?: { value: string; input: string; line: number; column: number; context: string }[]
  syntax?: SourceSummary
  atoms: Atom[]
  unchecked: Note[]
  surfaces?: Surface[]
}
/** File-local presentation inputs, not rendered elements or a dependency graph. */
export interface Surface {
  requiredProps?: string[]
  providedProps?: string[]
  unknownProps?: boolean
  renderContexts?: string[][]
  routes?: Route[]
  componentRef?: string
  fieldContainer?: boolean
  fieldGroup?: boolean
  ancestors?: string[]
  iconSlot?: string
  structuralViolation?: string
  kind: 'element' | 'definition' | 'recipe' | 'integration'
  owner: string
  target: string
  shared: boolean
  line: number
  column: number
  atoms: Atom[]
  references: string[]
  unresolved?: UnresolvedInput[]
}
export interface UnresolvedInput {
  deferredStyle?: { target: string; slot: string }
  channel: 'class' | 'style' | 'prop' | 'spread'
  property: string
  expression: string
  position: string
  line: number
}
export interface Declaration {
  property: string
  value: string
  category: string
}
export interface Catalogue {
  variables: Record<string, string[]>
}
export interface Entry {
  path: string
  blob: string
  mode: string
}
export interface Change {
  before: Entry | null
  after: Entry | null
  status: string
}
export interface Commits {
  base: string
  head: string
  mergeBase: string
}
export interface Finding {
  identity?: string
  legacyFingerprint?: string
  related?: string[]
  kind?: 'usage-violation' | 'system-change'
  contract?: string
  provenance?: { source: string; input: string; permitted: string; composition?: string }
  rule: string
  category: string
  property: string
  value: string
  reason: string
  file: string
  line: number
  column: number
  context: string
  before?: string | null
}
/** Line-independent identity for the same authored treatment. */
export function findingFingerprint(finding: Finding): string {
  return hash(
    canonical([
      'finding',
      finding.file,
      finding.context,
      finding.rule,
      finding.property,
      finding.value,
    ])
  )
}
/** Multiset comparison of authored treatments; source line movement is immaterial. */
export function introducedFindings<T extends Finding>(before: T[], after: T[]): T[] {
  const key = (finding: Finding) =>
    canonical([
      finding.file,
      finding.context,
      finding.rule,
      finding.property,
      finding.provenance?.input ?? finding.value,
    ])
  const counts = new Map<string, number>()
  for (const finding of before) counts.set(key(finding), (counts.get(key(finding)) ?? 0) + 1)
  return after.filter((finding) => {
    const count = counts.get(key(finding)) ?? 0
    if (!count) return true
    counts.set(key(finding), count - 1)
    return false
  })
}
export interface Report {
  /** Changed product files whose styling could not be compared. */
  coverageFailures?: (Note & { file: string; side: 'before' | 'after' })[]
  layoutAllowances?: import('#control-analysis/layout-allowances').LayoutAllowance[]
  colourAssignments?: {
    version: '1.0.0'
    before: { checked: number; verified: number; invalid: number; unresolved: number }
    after: { checked: number; verified: number; invalid: number; unresolved: number }
    introduced: number
    verifiedUsages: import('#control-analysis/colour-assignments').VerifiedColourUsage[]
  }
  contractsHash?: string
  centralSourceHashes?: { before: string; after: string }
  schemaVersion: string
  toolVersion: string
  policyVersion: string
  implementationHash: string
  catalogueHash: string
  catalogueVersion: string
  catalogueSourceCommit: string
  commits: Commits | null
  status: 'completed' | 'failed'
  flagged: boolean | null
  findings: Finding[]
  unchecked: (Note & { file: string; side: string })[]
  coverage: {
    checkedFiles: number
    excludedFiles: number
    unsupportedFiles: number
    governedInputs?: number
    ungovernedInputs?: number
    violations?: number
    systemChanges?: number
  }
  error?: string
}
let cachedImplementationHash: string | undefined
export function implementationHash(): string {
  if (cachedImplementationHash) return cachedImplementationHash
  const dir = new URL('./', import.meta.url)
  cachedImplementationHash = hash(
    canonical([
      ...readdirSync(dir)
        .filter((x) => x.endsWith('.ts'))
        .sort()
        .map((x) => [x, hash(readFileSync(new URL(x, dir)))]),
      ['package.json', hash(readFileSync(new URL('../../package.json', dir)))],
      ['bun.lock', hash(readFileSync(new URL('../../bun.lock', dir)))],
      ['contracts.json', hash(readFileSync(new URL('./contracts.json', dir)))],
      [
        'check-design-conformance.ts',
        hash(readFileSync(new URL('../check-design-conformance.ts', dir))),
      ],
    ])
  )
  return cachedImplementationHash
}
/** Scope is independent of the historical cases and their labels. */
export function scope(file: string): 'check' | 'exclude' | 'unsupported' {
  if (!/^(apps\/sim\/|packages\/(emcn|workflow-renderer)\/)/.test(file)) return 'exclude'
  if (file.startsWith('apps/sim/scripts/')) return 'exclude'
  if (
    /(?:^|\/)(?:node_modules|__tests__|__fixtures__|fixtures|dist|build|public|emails?|icons?|iso|og)(?:\/|\.)|\.(?:test|spec|generated|d)\.[cm]?[jt]sx?$/.test(
      file
    )
  )
    return 'exclude'
  if (file.startsWith('apps/sim/lib/desktop/')) return 'exclude'
  if (
    /apps\/sim\/app\/(?:\(landing\)|api)\/|apps\/sim\/(?:content|emails)\/|(?:opengraph|twitter)-image\.|(?:^|\/)og-utils\./.test(
      file
    )
  )
    return 'exclude'
  if (/\.(?:[cm]?[jt]sx?|css|html?)$/.test(file)) return 'check'
  return 'unsupported'
}
export function category(property: string): string | undefined {
  if (/^(?:color|background(?:-color|-image)?|.*-color|fill|stroke|caret-color)$/.test(property))
    return 'colours'
  if (/^(?:padding|margin|gap|row-gap|column-gap)(?:-|$)/.test(property)) return 'spacing'
  if (
    /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|flex-basis)$/.test(
      property
    )
  )
    return 'dimensions'
  if (
    /^(?:font(?:-|$)|line-height|letter-spacing|word-spacing|text-(?:align|transform|decoration|indent))/.test(
      property
    )
  )
    return 'typography'
  if (/^border.*radius$/.test(property)) return 'radii'
  if (/^(?:border|outline)(?:-|$)/.test(property)) return 'borders'
  if (
    /^(?:box-shadow|text-shadow|opacity|filter|backdrop-filter|mix-blend-mode|background-blend-mode)$/.test(
      property
    )
  )
    return 'effects'
  if (/^(?:display|position|flex|grid|align-|justify-|place-|order|float|clear)/.test(property))
    return 'layout'
  if (
    /^(?:overflow|visibility|white-space|text-overflow|clip|mask|line-clamp|-webkit-line-clamp)/.test(
      property
    )
  )
    return 'visibility'
  if (property === 'z-index' || property === 'isolation') return 'layering'
  if (/^(?:animation|transition|scale|rotate|transform|perspective)/.test(property)) return 'motion'
  return undefined
}
export function family(property: string): string {
  return property
    .replace(/^padding-.+$/, 'padding')
    .replace(/^margin-.+$/, 'margin')
    .replace(/^(?:row|column)-gap$/, 'gap')
    .replace(/^border-.+-radius$/, 'border-radius')
    .replace(
      /^border-(?:top|bottom|left|right|inline(?:-start|-end)?|block(?:-start|-end)?)-(width|color|style)$/,
      'border-$1'
    )
}
/** Longhand permissions cover that property; shorthand overrides can still affect protected siblings. */
export function ownsStyling(
  slot: { protected: string[]; allowed?: string[] } | undefined,
  property: string,
  group = category(property)
): boolean {
  if (!slot) return false
  const covers = (rule: string, target: string) =>
    rule === '*' || rule === target || rule === family(target) || target.startsWith(`${rule}-`)
  const protects = slot.protected.some(
    (rule) => rule === group || covers(rule, property) || covers(property, rule)
  )
  const permits = slot.allowed?.some((rule) => rule === group || covers(rule, property))
  return protects && !permits
}
/** Physical/logical overlap depends on inherited writing mode; keep it visible without claiming a proof. */
export function ambiguousStyling(
  slot: { protected: string[]; allowed?: string[] } | undefined,
  property: string
): boolean {
  if (!slot || ownsStyling(slot, property)) return false
  if (
    slot.allowed?.some((rule) => rule === '*' || rule === property || rule === category(property))
  )
    return false
  const dimension = /^(min-|max-)?(width|height|inline-size|block-size)$/.exec(property)
  const logical = /(?:^|-)(?:inline|block|start|end)(?:-|$)/
  const physical = /(?:^|-)(?:top|right|bottom|left)(?:-|$)/
  return slot.protected.some((rule) => {
    const otherDimension = /^(min-|max-)?(width|height|inline-size|block-size)$/.exec(rule)
    if (dimension && otherDimension)
      return (
        dimension[1] === otherDimension[1] &&
        /size$/.test(dimension[2]) !== /size$/.test(otherDimension[2])
      )
    return (
      family(rule) === family(property) &&
      ((logical.test(rule) && physical.test(property)) ||
        (physical.test(rule) && logical.test(property)))
    )
  })
}
