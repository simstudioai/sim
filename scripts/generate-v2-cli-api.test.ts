import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CLI_MANAGED_HEADERS,
  loadSummaries,
  renderBodyDiscriminator,
  renderSlotMap,
} from './generate-v2-cli-api'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('discriminated object request bodies', () => {
  const schema = z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('apply'),
        expectedFingerprint: z.string().describe('Fingerprint from preview.'),
        newLimitCredits: z.number().int().optional(),
      })
      .strict(),
    z.object({ action: z.literal('decline'), reason: z.string() }).strict(),
  ])

  it('exposes every branch field while requiring only the discriminator before selection', () => {
    const map = renderSlotMap(schema, '  ')
    expect(map).toContain(
      '"action": { kind: \'enum\', required: true, values: ["apply", "decline"]'
    )
    expect(map).toContain(
      '"expectedFingerprint": { kind: \'string\', describe: "Fingerprint from preview. Available when action is apply. Required when action is apply." }'
    )
    expect(map).toContain('"newLimitCredits": { kind: \'integer\'')
    expect(map).toContain(
      '"reason": { kind: \'string\', describe: "Available when action is decline. Required when action is decline." }'
    )
    expect(map?.match(/required: true/g)).toHaveLength(1)
  })

  it('unites shared enum choices without losing branch-specific validation', () => {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('first'), mode: z.enum(['a', 'b']).default('a') }),
      z.object({ action: z.literal('second'), mode: z.enum(['b', 'c']).default('c') }),
    ])
    expect(renderSlotMap(body, '  ')).toContain('values: ["a", "b", "c"]')
    expect(renderSlotMap(body, '  ')).not.toContain('default:')
    expect(renderBodyDiscriminator(body, '  ')).toContain('values: ["b", "c"]')
    expect(renderBodyDiscriminator(body, '  ')).toContain('default: "a"')
    expect(renderBodyDiscriminator(body, '  ')).toContain('default: "c"')
  })
})

describe('request headers reaching the CLI as flags', () => {
  /**
   * The client spreads contract headers last over its own block, so a flag for
   * one of these would let argv replace the profile's credential.
   */
  it('leaves out a header the CLI sets for itself', () => {
    const map = renderSlotMap(
      z.object({ 'x-api-key': z.string(), 'upload-token': z.string() }),
      '  ',
      CLI_MANAGED_HEADERS
    )
    expect(map).not.toContain('x-api-key')
    expect(map).toContain('upload-token')
  })
})

/**
 * Reads the denial sentences out of `openapi/shared.ts` as source text.
 *
 * The generator itself imports that module, but it resolves through the `@/`
 * alias, which the root vitest run has no resolver for. Parsing the literal
 * keeps the test bound to the same single source of truth: reword the sentence
 * and this recomputes the expected set, so a generator holding a stale copy of
 * it goes red instead of silently unmarking a family.
 */
function workspaceKeyDenialMarkers(): string[] {
  const source = readFileSync(
    path.join(ROOT, 'apps/sim/lib/api/contracts/v2/openapi/shared.ts'),
    'utf8'
  )
  const markers = [...source.matchAll(/export const (WORKSPACE_API_KEY_DENIED\w*) =\s*'([^']+)'/g)]
    .filter(([, name]) => name.startsWith('WORKSPACE_API_KEY_DENIED'))
    .map(([, , sentence]) => sentence)
  expect(markers.length).toBeGreaterThan(0)
  return markers
}

function generatedSource(): string {
  return readFileSync(path.join(ROOT, 'packages/sim-cli/src/generated/v2-api.ts'), 'utf8')
}

/** The body of one entry in the emitted `V2_OPERATIONS` table. */
function _generatedEntry(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))
  if (!match) throw new Error(`${name} is not in the generated operation table`)
  return match[1]
}

describe('operations that refuse a workspace API key', () => {
  /**
   * A count, not just named operations: pinning two of them would let a reword
   * confined to one contract family silently unmark every other one while the
   * pinned pair stayed green.
   */
  it('emits the marker for every operation the specs say refuses one', () => {
    const marked = [...loadSummaries(workspaceKeyDenialMarkers()).values()].filter(
      (doc) => doc.workspaceKeyUnsupported
    )
    expect(marked.length).toBeGreaterThan(0)
    expect(generatedSource().match(/workspaceKeyUnsupported: true/g)?.length ?? 0).toBe(
      marked.length
    )
  })
})
