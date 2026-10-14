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

describe('record coercion', () => {
  it('rejects the inline forms of toRecord and toRecordOrNull, including wrapped ones', () => {
    const source = [
      'const a = isRecordLike(value) ? value : {}',
      'render(isRecordLike(props) ? props : null)',
      'const g = isRecordLike(value) ? value : null // keep metadata',
      'const h = isRecordLike(value) ? value : {} /* default */',
      'const b = isRecordLike(input.payload)',
      '  ? input.payload',
      '  : null',
    ].join('\n')
    expect(descriptions('apps/sim/lib/example.ts', source)).toEqual([
      'isRecordLike(v) ? v : {}',
      'isRecordLike(v) ? v : {}',
      'isRecordLike(v) ? v : null',
      'isRecordLike(v) ? v : null',
      'isRecordLike(v) ? v : null',
    ])
  })

  it('treats optional chaining in the guard as the same property', () => {
    const source = 'const metadata = isRecordLike(existing?.metadata) ? existing.metadata : {}'
    expect(descriptions('apps/sim/lib/example.ts', source)).toEqual(['isRecordLike(v) ? v : {}'])
  })

  it('leaves a ternary that falls back to something else, or returns another value', () => {
    const source = [
      'const a = isRecordLike(value) ? value : undefined',
      'const b = isRecordLike(value) ? other : {}',
      'const c = isRecordLike(value) ? { ...value } : {}',
      'const d = isRecordLike(item?.data) ? item.meta : null',
      'const e = isRecordLike(value) ? value : null === other',
      'const f = isRecordLike(value) ? value : {}.constructor',
      'const i = isRecordLike(value) ? value : null',
      '  === other',
      'const j = isRecordLike(value) ? value : null // first',
      '  ?? fallback',
      'const k = isRecordLike(value) ? value : null as Shape',
      'const l = isRecordLike(value) ? value : nullableDefault',
    ].join('\n')
    expect(descriptions('apps/sim/lib/example.ts', source)).toEqual([])
  })
})
