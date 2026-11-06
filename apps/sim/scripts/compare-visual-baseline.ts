import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import sharp from 'sharp'

/**
 * Diffs two artifact directories from `test-workspace-visual-e2e.ts` (a `shots/` folder of PNGs and
 * a `report.json` beside it), lists every shot that changed, and exits non-zero when an area that
 * must stay identical through the Platform migration changed.
 *
 * bun scripts/compare-visual-baseline.ts <baselineDir> <headDir> [--threshold 0.001]
 *   [--tolerance 8] [--report compare.json]
 *
 * A protected shot is compared inside the content box the suite recorded, so restyling the sidebar
 * around an untouched page reports `chrome-only` and passes. A shot that vanished always fails:
 * a smaller head run proves nothing about the pages it skipped.
 */

export const PROTECTED_AREAS: ReadonlySet<string> = new Set([
  'canvas',
  'settings',
  'integrations',
  'resource',
])

const DEFAULT_CHANGED_RATIO = 0.001
const DEFAULT_PIXEL_TOLERANCE = 8
const BUDGET_GROWTH_RATIO = 0.05
const SHOT_DIRECTORY = 'shots'
const REPORT_FILE = 'report.json'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type ShotChangeKind =
  | 'changed'
  | 'chrome-only'
  | 'size-mismatch'
  | 'missing-from-head'
  | 'new-in-head'
  | 'unreadable'

export interface ShotChange {
  shot: string
  area: string
  kind: ShotChangeKind
  blocking: boolean
  detail: string
}

export interface VisualComparison {
  passed: boolean
  compared: number
  unchanged: number
  changes: ShotChange[]
  budgetGrowth: string[]
  error?: string
}

export interface CompareOptions {
  baselineDir: string
  headDir: string
  changedRatio?: number
  pixelTolerance?: number
}

interface RawImage {
  data: Buffer
  width: number
  height: number
}

/** The file name carries the area, so a comparison needs nothing but the two directories. */
function areaOf(shot: string) {
  return shot.split('__')[0] ?? ''
}

/** An unrecognized name is treated as protected: a typo must not exempt a shot. */
function isProtected(shot: string) {
  const parts = shot.split('__')
  return parts.length !== 5 || PROTECTED_AREAS.has(parts[0])
}

function listShots(directory: string): Set<string> {
  const shots = join(directory, SHOT_DIRECTORY)
  if (!statSync(shots, { throwIfNoEntry: false })?.isDirectory()) return new Set()
  return new Set(readdirSync(shots).filter((name) => name.endsWith('.png')))
}

interface ReportFacts {
  contentBoxes: Map<string, Box>
  budgets: Map<string, { jsBytes: number; cssBytes: number }>
}

function readReportFacts(directory: string): ReportFacts {
  const facts: ReportFacts = { contentBoxes: new Map(), budgets: new Map() }
  let parsed: Record<string, unknown>
  try {
    parsed = toRecord(JSON.parse(readFileSync(join(directory, REPORT_FILE), 'utf8')))
  } catch {
    return facts
  }
  for (const entry of Array.isArray(parsed.shots) ? parsed.shots : []) {
    const shot = toRecord(entry)
    const box = toRecord(shot.contentBox)
    if (typeof shot.file === 'string' && typeof box.width === 'number') {
      facts.contentBoxes.set(shot.file, {
        x: Number(box.x),
        y: Number(box.y),
        width: box.width,
        height: Number(box.height),
      })
    }
  }
  for (const entry of Array.isArray(parsed.routes) ? parsed.routes : []) {
    const route = toRecord(entry)
    const transferred = toRecord(route.transferred)
    if (typeof route.route === 'string' && typeof transferred.jsBytes === 'number') {
      facts.budgets.set(route.route, {
        jsBytes: transferred.jsBytes,
        cssBytes: Number(transferred.cssBytes),
      })
    }
  }
  return facts
}

async function decode(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** Share of pixels in the region differing on any channel by more than the tolerance. */
function changedShare(
  baseline: RawImage,
  head: RawImage,
  baselineBox: Box,
  headBox: Box,
  tolerance: number
): number {
  let changed = 0
  for (let row = 0; row < baselineBox.height; row += 1) {
    let left = ((baselineBox.y + row) * baseline.width + baselineBox.x) * 4
    let right = ((headBox.y + row) * head.width + headBox.x) * 4
    for (let column = 0; column < baselineBox.width; column += 1) {
      if (
        Math.abs(baseline.data[left] - head.data[right]) > tolerance ||
        Math.abs(baseline.data[left + 1] - head.data[right + 1]) > tolerance ||
        Math.abs(baseline.data[left + 2] - head.data[right + 2]) > tolerance ||
        Math.abs(baseline.data[left + 3] - head.data[right + 3]) > tolerance
      ) {
        changed += 1
      }
      left += 4
      right += 4
    }
  }
  return changed / Math.max(1, baselineBox.width * baselineBox.height)
}

function clampToImage(box: Box, image: RawImage): Box {
  const x = Math.max(0, Math.round(box.x))
  const y = Math.max(0, Math.round(box.y))
  return {
    x,
    y,
    width: Math.min(Math.round(box.width), image.width - x),
    height: Math.min(Math.round(box.height), image.height - y),
  }
}

const wholeImage = ({ width, height }: RawImage): Box => ({ x: 0, y: 0, width, height })
const percent = (share: number) => `${(share * 100).toFixed(2)}% of pixels`
const sameSize = (left: { width: number; height: number }, right: typeof left) =>
  left.width === right.width && left.height === right.height

/** Whether two PNGs of one page differ beyond the tolerances; a size change counts as a change. */
export async function diffPngFiles(
  baselinePath: string,
  headPath: string,
  options: { changedRatio?: number; pixelTolerance?: number } = {}
): Promise<{ changed: boolean; share: number | null }> {
  const [baseline, head] = await Promise.all([decode(baselinePath), decode(headPath)])
  if (!sameSize(baseline, head)) return { changed: true, share: null }
  const share = changedShare(
    baseline,
    head,
    wholeImage(baseline),
    wholeImage(head),
    options.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE
  )
  return { changed: share > (options.changedRatio ?? DEFAULT_CHANGED_RATIO), share }
}

function budgetGrowth(baseline: ReportFacts, head: ReportFacts): string[] {
  const growth: string[] = []
  for (const [route, before] of baseline.budgets) {
    const after = head.budgets.get(route)
    if (!after) continue
    for (const kind of ['jsBytes', 'cssBytes'] as const) {
      if (after[kind] > before[kind] * (1 + BUDGET_GROWTH_RATIO)) {
        growth.push(`${route} ${kind}: ${before[kind]} -> ${after[kind]}`)
      }
    }
  }
  return growth
}

async function compareShot(
  shot: string,
  baselineDir: string,
  headDir: string,
  baselineFacts: ReportFacts,
  headFacts: ReportFacts,
  ratio: number,
  tolerance: number
): Promise<ShotChange | null> {
  const area = areaOf(shot)
  const blocking = isProtected(shot)
  let baseline: RawImage
  let head: RawImage
  try {
    ;[baseline, head] = await Promise.all([
      decode(join(baselineDir, SHOT_DIRECTORY, shot)),
      decode(join(headDir, SHOT_DIRECTORY, shot)),
    ])
  } catch (error) {
    return { shot, area, kind: 'unreadable', blocking: true, detail: getErrorMessage(error) }
  }
  const baselineBox = baselineFacts.contentBoxes.get(shot)
  const headBox = headFacts.contentBoxes.get(shot)
  const fullSameSize = sameSize(baseline, head)

  if (blocking && baselineBox && headBox) {
    const left = clampToImage(baselineBox, baseline)
    const right = clampToImage(headBox, head)
    if (!sameSize(left, right)) {
      return {
        shot,
        area,
        kind: 'size-mismatch',
        blocking,
        detail: `content ${left.width}x${left.height} became ${right.width}x${right.height}`,
      }
    }
    const content = changedShare(baseline, head, left, right, tolerance)
    if (content > ratio) {
      return { shot, area, kind: 'changed', blocking, detail: `content: ${percent(content)}` }
    }
    if (!fullSameSize) {
      return { shot, area, kind: 'chrome-only', blocking: false, detail: 'viewport size changed' }
    }
    const whole = changedShare(baseline, head, wholeImage(baseline), wholeImage(head), tolerance)
    return whole > ratio
      ? { shot, area, kind: 'chrome-only', blocking: false, detail: `chrome: ${percent(whole)}` }
      : null
  }

  if (!fullSameSize) {
    return {
      shot,
      area,
      kind: 'size-mismatch',
      blocking,
      detail: `${baseline.width}x${baseline.height} became ${head.width}x${head.height}`,
    }
  }
  const share = changedShare(baseline, head, wholeImage(baseline), wholeImage(head), tolerance)
  return share > ratio ? { shot, area, kind: 'changed', blocking, detail: percent(share) } : null
}

export async function compareVisualBaselines(options: CompareOptions): Promise<VisualComparison> {
  const ratio = options.changedRatio ?? DEFAULT_CHANGED_RATIO
  const tolerance = options.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE
  const baselineShots = listShots(options.baselineDir)
  const headShots = listShots(options.headDir)
  const baselineFacts = readReportFacts(options.baselineDir)
  const headFacts = readReportFacts(options.headDir)
  const changes: ShotChange[] = []
  let compared = 0

  for (const shot of [...baselineShots].sort()) {
    if (!headShots.has(shot)) {
      changes.push({
        shot,
        area: areaOf(shot),
        kind: 'missing-from-head',
        blocking: true,
        detail: 'in the baseline, absent from the head run',
      })
      continue
    }
    compared += 1
    const change = await compareShot(
      shot,
      options.baselineDir,
      options.headDir,
      baselineFacts,
      headFacts,
      ratio,
      tolerance
    )
    if (change) changes.push(change)
  }
  for (const shot of [...headShots].sort()) {
    if (baselineShots.has(shot)) continue
    changes.push({
      shot,
      area: areaOf(shot),
      kind: 'new-in-head',
      blocking: false,
      detail: 'no baseline to compare against',
    })
  }

  const error = compared === 0 ? 'No shot exists in both directories' : undefined
  return {
    passed: !error && !changes.some((change) => change.blocking),
    compared,
    unchanged: compared - changes.filter((change) => change.kind !== 'missing-from-head').length,
    changes,
    budgetGrowth: budgetGrowth(baselineFacts, headFacts),
    ...(error ? { error } : {}),
  }
}

function formatComparison(result: VisualComparison): string {
  const lines = [
    `${result.passed ? 'PASS' : 'FAIL'}: ${result.compared} compared, ${result.changes.length} listed`,
  ]
  if (result.error) lines.push(`  ${result.error}`)
  for (const change of result.changes) {
    const marker = change.blocking ? 'BLOCKING' : 'info'
    lines.push(`  [${marker}] ${change.kind} ${change.shot}: ${change.detail}`)
  }
  for (const growth of result.budgetGrowth) lines.push(`  [budget] ${growth}`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      threshold: { type: 'string' },
      tolerance: { type: 'string' },
      report: { type: 'string' },
    },
  })
  const [baselineDir, headDir] = positionals
  if (!baselineDir || !headDir) {
    throw new Error('usage: compare-visual-baseline.ts <baselineDir> <headDir>')
  }
  const result = await compareVisualBaselines({
    baselineDir: resolve(baselineDir),
    headDir: resolve(headDir),
    changedRatio: values.threshold ? Number(values.threshold) : undefined,
    pixelTolerance: values.tolerance ? Number(values.tolerance) : undefined,
  })
  process.stdout.write(formatComparison(result))
  if (values.report) {
    const reportPath = resolve(values.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`)
  }
  process.exit(result.passed ? 0 : 1)
}

if (import.meta.main) {
  await main()
}
