import { describe, expect, it } from 'vitest'
import { ModalBlock } from '@/blocks/blocks/modal'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('ModalBlock', () => {
  const buildParams = ModalBlock.tools.config!.params!

  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  it('coerces the chat sampling controls to numbers at execution time', () => {
    const params = resolve({
      operation: 'chat_completion',
      endpointUrl: 'https://my-endpoint.us-west.modal.direct',
      model: 'Qwen/Qwen3.5-4B',
      content: 'hello',
      systemPrompt: 'be terse',
      maxTokens: '256',
      temperature: '0',
      topP: '0.9',
    })

    expect(params).toMatchObject({
      endpointUrl: 'https://my-endpoint.us-west.modal.direct',
      model: 'Qwen/Qwen3.5-4B',
      content: 'hello',
      systemPrompt: 'be terse',
      maxTokens: 256,
      temperature: 0,
      topP: 0.9,
    })
  })

  it('drops blank sampling controls rather than sending NaN', () => {
    const params = buildParams({
      operation: 'chat_completion',
      endpointUrl: 'https://my-endpoint.us-west.modal.direct',
      model: 'Qwen/Qwen3.5-4B',
      content: 'hello',
      maxTokens: '',
      temperature: '',
      topP: '',
    })

    expect(params).not.toHaveProperty('maxTokens')
    expect(params).not.toHaveProperty('temperature')
    expect(params).not.toHaveProperty('topP')
  })
})
