import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CLI_MANAGED_HEADERS,
  loadSummaries,
  render,
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

  it('emits branch requirements and does not require an opaque JSON body', () => {
    const metadata = renderBodyDiscriminator(schema, '  ')
    expect(metadata).toContain('field: "action"')
    expect(metadata).toContain('"expectedFingerprint": { kind: \'string\', required: true')
    expect(metadata).toContain('"reason": { kind: \'string\', required: true')
    const source = render(
      [
        {
          name: 'resolveRequest',
          exportName: 'v2ResolveRequestContract',
          domain: 'requests',
          contract: {
            method: 'POST',
            path: '/api/v2/requests/[requestId]/resolve',
            body: schema,
            response: { mode: 'json', schema: z.object({ data: z.object({ id: z.string() }) }) },
          },
        },
      ],
      new Map()
    )
    expect(source).toContain('bodyDiscriminator:')
    expect(source).not.toContain('opaqueBody: true')
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

  it('resolves named branches and fields while preserving discriminator descriptions', () => {
    const fingerprint = z.string().meta({ id: 'Fingerprint' })
    const body = z.discriminatedUnion('action', [
      z
        .object({ action: z.literal('apply').describe('Apply the change.'), fingerprint })
        .meta({ id: 'ApplyDecision' }),
      z
        .object({
          action: z.literal('decline').describe('Decline the request.'),
          reason: z.string(),
        })
        .meta({ id: 'DeclineDecision' }),
    ])
    const map = renderSlotMap(body, '  ')
    expect(map).toContain('"fingerprint": { kind: \'string\'')
    expect(map).toContain('describe: "apply: Apply the change. decline: Decline the request."')
    expect(renderBodyDiscriminator(body, '  ')).toContain(
      '"fingerprint": { kind: \'string\', required: true'
    )
  })

  it('preserves opaque single-row and batch unions and their shared workspace field', () => {
    const body = z.union([
      z.object({ workspaceId: z.string(), data: z.record(z.string(), z.unknown()) }),
      z.object({ workspaceId: z.string(), rows: z.array(z.record(z.string(), z.unknown())) }),
    ])
    expect(renderBodyDiscriminator(body, '  ')).toBeNull()
    expect(renderSlotMap(body, '  ')).toBe(
      '{\n    "workspaceId": { kind: \'string\', required: true },\n  }'
    )
  })

  it('keeps incompatible flag shapes on the existing opaque body path', () => {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('first'), value: z.string() }),
      z.object({ action: z.literal('second'), value: z.object({ id: z.string() }) }),
    ])
    expect(renderBodyDiscriminator(body, '  ')).toBeNull()
  })
})

describe('a field the contract types as nullable', () => {
  /**
   * String flags preserve their literal value; numeric flags have an unambiguous null spelling.
   */
  it('describes it no differently from any other string', () => {
    const map = renderSlotMap(
      z.object({ description: z.string().nullable().optional().describe('Replacement.') }),
      '  '
    )
    expect(map).toContain("kind: 'string'")
    expect(map).not.toContain('nullable')
  })

  it.each([z.number(), z.number().int()])(
    'carries numeric nullability through the descriptor',
    (value) => {
      const map = renderSlotMap(z.object({ creditLimit: value.nullable() }), '  ')
      expect(map).toContain('nullable: true, required: true')
      expect(map).toContain(`kind: '${value.isInt ? 'integer' : 'number'}'`)
    }
  )
})

describe('request headers reaching the CLI as flags', () => {
  /**
   * `getFileUpload` reads its session through an `upload-token` header, and the
   * operation table listed only its params and query — so the runtime had no
   * field to build a flag from and every call was rejected as invalid input
   * before it left the machine.
   */
  it('describes a contract header the caller has to supply', () => {
    const map = renderSlotMap(
      z.object({ 'upload-token': z.string().describe('Signed upload control token.') }),
      '  ',
      CLI_MANAGED_HEADERS
    )
    expect(map).toContain('"upload-token"')
    expect(map).toContain('required: true')
  })

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
function generatedEntry(source: string, name: string): string {
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

  it('marks restricted operations and leaves workspace-key-capable siblings alone', () => {
    const source = generatedSource()
    for (const name of ['listMcpServerTools', 'listSecrets', 'undeployWorkflow']) {
      expect(generatedEntry(source, name)).toContain('workspaceKeyUnsupported: true')
    }
    for (const name of ['listMcpServers', 'getMcpServer', 'listWorkflows']) {
      expect(generatedEntry(source, name)).not.toContain('workspaceKeyUnsupported')
    }
  })
})
