import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { PLATFORM_ALLOWLISTS } from './platform-allowlists'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORKFLOW = '.github/workflows/platform-design.yml'

/** The `pull_request.paths` filters, in order. */
function pathFilters(): string[] {
  const workflow = readFileSync(path.join(ROOT, WORKFLOW), 'utf8')
  const block = workflow.slice(
    workflow.indexOf('    paths:'),
    workflow.indexOf('  workflow_dispatch:')
  )
  return [...block.matchAll(/^\s+- '([^']+)'$/gm)].map(([, pattern]) => pattern as string)
}

/** GitHub's paths filter: the last pattern that matches decides, and `!` excludes. */
function triggers(filters: readonly string[], file: string): boolean {
  let included = false
  for (const filter of filters) {
    const negated = filter.startsWith('!')
    const glob = negated ? filter.slice(1) : filter
    const pattern = glob
      .split(/(\*\*\/?|\*)/)
      .map((part) =>
        part === '**' || part === '**/'
          ? '.*'
          : part === '*'
            ? '[^/]*'
            : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      )
      .join('')
    if (new RegExp(`^${pattern}$`).test(file)) included = !negated
  }
  return included
}

/** An allowlisted module path (`lib/auth`) as the file it names. */
function moduleFile(entry: string): string {
  const base = `apps/sim/${entry}`
  const file = ['.ts', '.tsx', '/index.ts', '/index.tsx', '']
    .map((suffix) => base + suffix)
    .find((candidate) => existsSync(path.join(ROOT, candidate)))
  return file ?? base
}

it('runs platform-design when an in-process dependency of the product changes', () => {
  const filters = pathFilters()
  const uncovered = [
    ...Object.keys(PLATFORM_ALLOWLISTS.serverSeamHelpers),
    ...Object.keys(PLATFORM_ALLOWLISTS.platformHostModules),
  ]
    .map(moduleFile)
    .filter((file) => !triggers(filters, file))
  expect(uncovered, `add a paths filter to ${WORKFLOW} for each`).toEqual([])
})

it('reads the filters the way GitHub does', () => {
  const filters = [
    'apps/sim/platform/**',
    '!apps/sim/platform/docs/**',
    'apps/sim/platform/docs/org-parity.md',
  ]
  expect(triggers(filters, 'apps/sim/platform/lib/data/mode.ts')).toBe(true)
  expect(triggers(filters, 'apps/sim/platform/docs/workspace-ui.md')).toBe(false)
  expect(triggers(filters, 'apps/sim/platform/docs/org-parity.md')).toBe(true)
  expect(triggers(['scripts/check-platform-*'], 'scripts/check-platform-css.ts')).toBe(true)
  expect(triggers(['scripts/check-platform-*'], 'scripts/nested/check-platform-css.ts')).toBe(false)
})
