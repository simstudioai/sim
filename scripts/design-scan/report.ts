import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { ColourAssignmentReport } from '#control-analysis/colour-assignments'
import type { ControlInventory } from '#control-analysis/inventory'
import type { LayoutAllowance } from '#control-analysis/layout-allowances'
import type { ReviewReport } from '#control-analysis/review'
import type { ShadowExtrasReport } from '#control-analysis/shadow-extras'
import type { TypographyReview } from '#control-analysis/typography'
import type { Inventory } from './inventory'

/** Resolve existing ancestors so a symlink cannot redirect output into the source checkout. */
export function validateOutput(output: string, repo: string): string {
  const resolved = path.resolve(output)
  if (existsSync(resolved)) throw new Error('Output directory already exists; choose a new path')
  let ancestor = path.dirname(resolved)
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const actual = path.resolve(realpathSync(ancestor), path.relative(ancestor, resolved))
  const relative = path.relative(realpathSync(repo), actual)
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Output must be outside the scanned repository')
  return actual
}

/** One versioned, atomic report is the scanner and Studio handoff. */
export function writeResults(
  output: string,
  inventory: Inventory,
  identity: unknown,
  metrics: unknown,
  controls: ControlInventory,
  details: {
    colourAssignments: ColourAssignmentReport
    shadowExtras: ShadowExtrasReport
    typographyReview: TypographyReview
    layoutAllowances: LayoutAllowance[]
    review: ReviewReport
  }
): void {
  if (existsSync(output)) throw new Error('Output directory already exists; refusing to overwrite')
  mkdirSync(path.dirname(output), { recursive: true })
  const temp = mkdtempSync(path.join(path.dirname(output), '.conformance-inventory-'))
  try {
    writeFileSync(
      path.join(temp, 'scan.json'),
      `${JSON.stringify(
        {
          version: 1,
          identity: {
            ...(identity as object),
            commit: inventory.commit,
            treeHash: inventory.treeHash,
            status: inventory.status,
          },
          inventory,
          controls,
          details,
          metrics,
        },
        null,
        2
      )}\n`
    )
    renameSync(temp, output)
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw error
  }
}
