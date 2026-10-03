import { describe, expect, it } from 'vitest'
import { findViolations } from './check-utils-enforcement'

const ES2023 = 'export const sorted = (items: number[]) => items.toSorted()\n'
const INLINE_ERROR_MESSAGE =
  "export const message = (e: unknown) => (e instanceof Error ? e.message : 'failed')\n"

function descriptions(file: string, source: string) {
  return findViolations(file, source).map(({ description }) => description)
}

describe('helper-source exemptions', () => {
  it('still applies browser-runtime rules to @sim/utils, which ships to the browser', () => {
    expect(descriptions('packages/utils/src/array.ts', ES2023)).toHaveLength(1)
  })

  it('still applies browser-runtime rules to allowlisted files', () => {
    expect(descriptions('packages/cli/src/index.ts', ES2023)).toHaveLength(1)
  })

  it('lets @sim/utils use the primitive its helper replaces', () => {
    expect(descriptions('packages/utils/src/errors.ts', INLINE_ERROR_MESSAGE)).toEqual([])
  })

  it('rejects that primitive everywhere else', () => {
    expect(descriptions('apps/sim/lib/example.ts', INLINE_ERROR_MESSAGE)).toHaveLength(1)
  })
})
