import { describe, expect, it } from 'vitest'
import { findRawNumericReads, numericEnvNames } from './check-env-numbers'

const NUMERIC = new Set(['PII_MASK_CHUNK_CONCURRENCY', 'COST_MULTIPLIER'])
const IMPORT =
  "import { env, envNumber } from '@/lib/core/config/env'; import { resolveCostMultiplier } from '@/lib/core/config/cost-multiplier'\n"

const lines = (body: string, file = 'file.ts') =>
  findRawNumericReads(file, `${IMPORT}${body}`, NUMERIC).map((hit) => hit.line - 2)

describe('numeric env names', () => {
  it('reads the numbers the schema declares, through any chain, and nothing else', () => {
    const schema = `export const env = createEnv({
  server: {
    A: z.number().optional(),
    B: z.coerce.number().int().positive().optional(),
    C: z.string().optional(),
    D: z.string().transform(Number),
    E: z.boolean().optional(),
  },
})`
    expect([...numericEnvNames(schema)].sort()).toEqual(['A', 'B'])
  })
})

describe('raw numeric env reads', () => {
  it('reports the read that reached mapWithConcurrency raw before #10326', () => {
    expect(
      lines(`const CHUNK_CONCURRENCY = env.PII_MASK_CHUNK_CONCURRENCY ?? 64
await mapWithConcurrency(items, CHUNK_CONCURRENCY, run)`)
    ).toEqual([0])
  })

  it('reports an element access and a destructured read', () => {
    expect(
      lines(`const a = env['PII_MASK_CHUNK_CONCURRENCY']
const { COST_MULTIPLIER, OTHER } = env`)
    ).toEqual([0, 1])
  })

  it('accepts a read that is the first argument of envNumber or a listed normalizer', () => {
    expect(
      lines(`const a = envNumber(env.PII_MASK_CHUNK_CONCURRENCY, 64, { min: 1, integer: true })
const b = resolveCostMultiplier(env.COST_MULTIPLIER, isProd)`)
    ).toEqual([])
  })

  it('reports a read that is only a later argument of envNumber', () => {
    expect(lines('const a = envNumber(1, env.COST_MULTIPLIER)')).toEqual([0])
  })

  it('ignores a variable the schema does not declare numeric, and an env the config does not export', () => {
    expect(lines('const a = env.DATABASE_URL')).toEqual([])
    expect(
      findRawNumericReads(
        'file.ts',
        "import { env } from 'node:process'\nconst a = env.COST_MULTIPLIER",
        NUMERIC
      )
    ).toEqual([])
    expect(
      findRawNumericReads('file.ts', 'const env = {}\nconst a = env.COST_MULTIPLIER', NUMERIC)
    ).toEqual([])
  })

  it('follows an aliased import and every relative form that resolves to the config module', () => {
    const read = (file: string, importLine: string) =>
      findRawNumericReads(file, `${importLine}\nconst a = appEnv.COST_MULTIPLIER`, NUMERIC).length
    expect(
      read('apps/sim/lib/core/config/env-flags.ts', "import { env as appEnv } from './env'")
    ).toBe(1)
    expect(
      read('apps/sim/lib/billing/costs.ts', "import { env as appEnv } from '../core/config/env'")
    ).toBe(1)
    expect(
      read('apps/sim/lib/billing/costs.ts', 'import { env as appEnv } from "@/lib/core/config/env"')
    ).toBe(1)
    expect(read('apps/sim/lib/billing/costs.ts', "import { env as appEnv } from './env'")).toBe(0)
  })

  it('does not trust a local function that only shares a normalizer name', () => {
    expect(
      findRawNumericReads(
        'file.ts',
        "import { env } from '@/lib/core/config/env'\nconst envNumber = (value: unknown) => value\nconst a = envNumber(env.COST_MULTIPLIER, 1)",
        NUMERIC
      )
    ).toHaveLength(1)
  })

  it('follows an aliased normalizer and a normalizer reached through a namespace import', () => {
    expect(
      findRawNumericReads(
        'file.ts',
        "import { env, envNumber as toNumber } from '@/lib/core/config/env'\nconst a = toNumber(env.COST_MULTIPLIER, 1)",
        NUMERIC
      )
    ).toEqual([])
    expect(
      findRawNumericReads(
        'file.ts',
        "import * as config from '@/lib/core/config/env'\nconst a = config.envNumber(config.env.COST_MULTIPLIER, 1)",
        NUMERIC
      )
    ).toEqual([])
  })

  it('reads through a namespace import of the config module', () => {
    expect(
      findRawNumericReads(
        'file.ts',
        "import * as config from '@/lib/core/config/env'\nconst a = config.env.COST_MULTIPLIER",
        NUMERIC
      )
    ).toHaveLength(1)
  })

  it('accepts an annotation within two lines above, and no farther', () => {
    expect(
      lines(`// env-number-normalized: parsed with Number() below
const a = env.COST_MULTIPLIER`)
    ).toEqual([])
    expect(
      lines(`// env-number-normalized: too far
const gap = 1
const filler = 2
const a = env.COST_MULTIPLIER`)
    ).toEqual([3])
  })
})
