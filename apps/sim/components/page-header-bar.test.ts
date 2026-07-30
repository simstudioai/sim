/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGE_HEADER_BAR } from '@/components/page-header-bar'

/** The geometry every page header bar shares, minus the top padding. */
const BAR_SIGNATURE = 'px-[16px]'
const LANE_VAR = 'var(--workspace-content-title-bar-inset)'

const ROOTS = ['app', 'components'].map((dir) => join(process.cwd(), dir))

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full)
      continue
    }
    if (/\.tsx?$/.test(entry)) yield full
  }
}

describe('PAGE_HEADER_BAR', () => {
  it('reserves the desktop title-bar lane in its top padding', () => {
    // Without this the bar sits under the macOS traffic lights and the sidebar
    // expander whenever the sidebar is collapsed in the desktop app.
    expect(PAGE_HEADER_BAR).toContain(LANE_VAR)
    expect(PAGE_HEADER_BAR).toContain(BAR_SIGNATURE)
  })

  it('is the only definition of the page header bar geometry', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (file.endsWith(join('components', 'page-header-bar.ts'))) continue
        const source = readFileSync(file, 'utf8')
        // A header bar re-derived inline: the shared gutter plus the old fixed top
        // padding, rather than composing PAGE_HEADER_BAR.
        if (source.includes(`${BAR_SIGNATURE} pt-[8.5px]`)) {
          offenders.push(file.replace(process.cwd(), '.'))
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
