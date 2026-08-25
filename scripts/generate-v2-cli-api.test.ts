import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CLI_MANAGED_HEADERS, isNullable, renderSlotMap } from './generate-v2-cli-api'

/** The JSON Schema the CLI generator actually reads, for one field's schema. */
function jsonFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(z.object({ field: schema }), {
    io: 'input',
    unrepresentable: 'any',
  }) as { properties: Record<string, Record<string, unknown>> }
  return json.properties.field
}

describe('nullability carried through to the CLI', () => {
  /**
   * Five contract fields documented "null clears it" and reached the terminal as
   * plain strings, so the word `null` was stored as its four characters. The
   * runtime can only offer a clearing flag for a field it is told about.
   */
  it('reports a nullable string', () => {
    expect(isNullable(jsonFor(z.string().nullable().optional()))).toBe(true)
  })

  it('reports a nullable enum', () => {
    expect(isNullable(jsonFor(z.enum(['vector', 'hybrid']).nullable().optional()))).toBe(true)
  })

  it('does not report a merely optional field', () => {
    expect(isNullable(jsonFor(z.string().optional()))).toBe(false)
  })

  it('does not report a required field', () => {
    expect(isNullable(jsonFor(z.string()))).toBe(false)
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
