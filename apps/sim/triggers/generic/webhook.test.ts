/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { genericWebhookTrigger } from '@/triggers/generic/webhook'

function setupInstructions(): string {
  return String(
    genericWebhookTrigger.subBlocks.find((subBlock) => subBlock.id === 'triggerInstructions')
      ?.defaultValue
  )
}

describe('genericWebhookTrigger', () => {
  it('declares the request metadata so it can be referenced from later blocks', () => {
    expect(Object.keys(genericWebhookTrigger.outputs)).toEqual(['method', 'query', 'headers'])
    expect(genericWebhookTrigger.outputs.method.type).toBe('string')
    expect(genericWebhookTrigger.outputs.query.type).toBe('object')
    expect(genericWebhookTrigger.outputs.headers.type).toBe('object')
  })

  it('names the methods the endpoint actually accepts', () => {
    expect(setupInstructions()).toContain('GET, POST, PUT, PATCH and DELETE requests')
  })

  it('names every reserved key the input carries', () => {
    const instructions = setupInstructions()

    for (const key of Object.keys(genericWebhookTrigger.outputs)) {
      expect(instructions).toContain(`"${key}"`)
    }
    expect(instructions).toContain('Headers that carry credentials are withheld.')
  })
})
