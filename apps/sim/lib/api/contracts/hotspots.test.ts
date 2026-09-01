/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { functionExecuteBodySchema } from '@/lib/api/contracts/hotspots'

describe('function execute input', () => {
  const bodySchema = functionExecuteBodySchema

  it.each(['javascript', 'python', 'shell'] as const)('accepts the %s language', (language) => {
    const result = bodySchema.safeParse({ code: 'echo ok', language })

    expect(result.success).toBe(true)
  })

  it('defaults omitted languages to JavaScript', () => {
    const result = bodySchema.parse({ code: 'return 1' })

    expect(result.language).toBe('javascript')
  })

  it('accepts unknown legacy languages for executor compatibility', () => {
    const result = bodySchema.safeParse({ code: 'puts :ok', language: 'ruby' })

    expect(result.success).toBe(true)
  })

  it('requires a workspace destination for a sandbox file export', () => {
    const result = bodySchema.safeParse({
      code: 'return 1',
      outputSandboxPath: '/tmp/result.csv',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ['outputPath'] }))
  })

  it('rejects a whitespace-only workspace destination for a sandbox file export', () => {
    const result = bodySchema.safeParse({
      code: 'return 1',
      outputSandboxPath: '/tmp/result.csv',
      outputPath: '   ',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ['outputPath'] }))
  })

  it('accepts a sandbox file export with its workspace destination', () => {
    const result = bodySchema.safeParse({
      code: 'return 1',
      outputSandboxPath: '/tmp/result.csv',
      outputPath: 'files/result.csv',
    })

    expect(result.success).toBe(true)
  })
})
