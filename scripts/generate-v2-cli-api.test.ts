import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CLI_MANAGED_HEADERS, loadSummaries, renderSlotMap } from './generate-v2-cli-api'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('a field the contract types as nullable', () => {
  /**
   * The operation table describes what the CLI can build a flag from, and a flag
   * that sends JSON `null` is not one of them: `--no-<flag>` already means "send
   * this boolean as false" on 37 flags, and `--description ''` is how a string
   * is emptied. Emitting the nullability invited a second meaning for one
   * spelling, so it is no longer carried.
   */
  it('describes it no differently from any other string', () => {
    const map = renderSlotMap(
      z.object({ description: z.string().nullable().optional().describe('Replacement.') }),
      '  '
    )
    expect(map).toContain("kind: 'string'")
    expect(map).not.toContain('nullable')
  })
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
