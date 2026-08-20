/**
 * @vitest-environment node
 */
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
  const selectTool = ModalBlock.tools.config!.tool!

  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  const operationIds =
    ModalBlock.subBlocks
      .find((subBlock) => subBlock.id === 'operation')
      ?.options?.map((option) => (option as { id: string }).id) ?? []

  it('maps every dropdown operation onto a registered tool', () => {
    expect(operationIds).toHaveLength(3)
    expect(new Set(operationIds.map((id) => selectTool({ operation: id })))).toEqual(
      new Set(ModalBlock.tools.access)
    )
  })

  it('gives every subblock a unique id', () => {
    const ids = ModalBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('forwards the proxy token pair on every operation', () => {
    for (const operation of operationIds) {
      const params = buildParams({ operation, tokenId: 'wk-1', tokenSecret: 'ws-2' })
      expect(params).toMatchObject({ tokenId: 'wk-1', tokenSecret: 'ws-2' })
    }
  })

  it('renames the call-function subblocks onto the tool param names', () => {
    const params = resolve({
      operation: 'call_function',
      functionUrl: 'https://acme--app-fn.modal.run',
      method: 'PUT',
      requestBody: '{"prompt":"hi"}',
      requestHeaders: [{ id: '1', cells: { Key: 'X-Trace', Value: 'abc' } }],
      queryParams: [{ id: '2', cells: { Key: 'debug', Value: '1' } }],
    })

    expect(params).toMatchObject({
      url: 'https://acme--app-fn.modal.run',
      method: 'PUT',
      body: '{"prompt":"hi"}',
      headers: [{ id: '1', cells: { Key: 'X-Trace', Value: 'abc' } }],
      queryParams: [{ id: '2', cells: { Key: 'debug', Value: '1' } }],
    })
  })

  it('omits an empty body so a GET call is not given one', () => {
    const params = buildParams({
      operation: 'call_function',
      functionUrl: 'https://acme--app-fn.modal.run',
      method: 'GET',
      requestBody: '',
    })

    expect(params).not.toHaveProperty('body')
  })

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

  it('leaves a blank endpoint URL unset so the shared inference default applies', () => {
    for (const operation of ['list_models', 'chat_completion']) {
      expect(buildParams({ operation, endpointUrl: '' })).not.toHaveProperty('endpointUrl')
      expect(
        buildParams({ operation, endpointUrl: 'https://my-endpoint.modal.direct' })
      ).toMatchObject({ endpointUrl: 'https://my-endpoint.modal.direct' })
    }
  })

  it('never marks the endpoint URL required, matching the skill that says to leave it empty', () => {
    expect(
      ModalBlock.subBlocks.find((subBlock) => subBlock.id === 'endpointUrl')?.required
    ).toBeUndefined()
  })

  it('requires the token pair only where Modal always authenticates', () => {
    const requiredFor = (id: string) =>
      ModalBlock.subBlocks.find((subBlock) => subBlock.id === id)?.required

    expect(requiredFor('tokenId')).toEqual({
      field: 'operation',
      value: ['chat_completion', 'list_models'],
    })
    expect(requiredFor('tokenSecret')).toEqual(requiredFor('tokenId'))
  })
})
