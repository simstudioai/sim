import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CLI_MANAGED_HEADERS, renderSlotMap } from './generate-v2-cli-api'

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
