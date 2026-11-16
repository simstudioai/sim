import { describe, expect, it } from 'vitest'
import { TypeformV2Block } from '@/blocks/blocks/typeform'
import type { BlockToolParamsContext } from '@/blocks/types'
import { createFormTool } from '@/tools/typeform/create_form'
import { updateFormTool } from '@/tools/typeform/update_form'
import type { ToolConfig } from '@/tools/types'

/**
 * Assertions run against `{ ...inputs, ...mapper(inputs, context) }`, the shape both the canvas
 * handler and the tool-call transform forward: a key the mapper leaves out keeps its raw value.
 */
describe('TypeformV2Block params mapper', () => {
  const mapper = TypeformV2Block.tools.config?.params
  if (!mapper) throw new Error('TypeformV2Block is missing its params mapper')

  const resolve = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
    ...inputs,
    ...mapper(inputs, context),
  })

  const patchBody = (params: Record<string, unknown>) => {
    const tool: ToolConfig = updateFormTool
    const body = tool.request.body
    if (!body) throw new Error('Expected a body builder')
    return body(params)
  }

  const createBody = (params: Record<string, unknown>) => {
    const tool: ToolConfig = createFormTool
    const body = tool.request.body
    if (!body) throw new Error('Expected a body builder')
    return body(params)
  }

  it('sends patch operations a model passed as an array on a tool call', () => {
    const operations = [{ op: 'replace', path: '/title', value: 'Renamed' }]
    const params = resolve(
      { apiKey: 'k', formId: 'abc123', operations },
      { operation: 'typeform_update_form' }
    )

    expect(patchBody(params)).toEqual(operations)
  })

  it('sends fields and settings a model passed as structured values on a tool call', () => {
    const fields = [{ type: 'short_text', title: 'Name?' }]
    const settings = { is_public: false }
    const params = resolve(
      { apiKey: 'k', title: 'Survey', fields, settings },
      { operation: 'typeform_create_form' }
    )

    expect(createBody(params)).toMatchObject({ title: 'Survey', fields, settings })
  })

  it('still parses JSON text typed on the canvas', () => {
    const params = resolve({
      operation: 'typeform_update_form',
      apiKey: 'k',
      formId: 'abc123',
      operations: '[{"op":"replace","path":"/settings/is_public","value":false}]',
    })

    expect(patchBody(params)).toEqual([
      { op: 'replace', path: '/settings/is_public', value: false },
    ])
  })
})
