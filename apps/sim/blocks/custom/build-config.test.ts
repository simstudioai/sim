import { describe, expect, it } from 'vitest'
import type { WorkflowInputField } from '@/lib/workflows/input-format'
import {
  assembleCustomBlockInputMapping,
  buildCustomBlockConfig,
  type CustomBlockRow,
  isReservedOutputName,
} from '@/blocks/custom/build-config'
import type { BlockIcon } from '@/blocks/types'

const icon: BlockIcon = () => null as never

const row: CustomBlockRow = {
  type: 'custom_block_abc123',
  name: 'Invoice Parser',
  description: 'Extracts fields from an invoice',
  workflowId: 'wf-1',
}

function findSub(config: ReturnType<typeof buildCustomBlockConfig>, id: string) {
  return config.subBlocks.find((s) => s.id === id)
}

describe('isReservedOutputName', () => {
  it('rejects the system output fields case-insensitively', () => {
    expect(isReservedOutputName('cost')).toBe(true)
    expect(isReservedOutputName('Cost')).toBe(true)
    expect(isReservedOutputName(' success ')).toBe(true)
    expect(isReservedOutputName('error')).toBe(true)
    expect(isReservedOutputName('result')).toBe(false)
    expect(isReservedOutputName('cost_2')).toBe(false)
    expect(isReservedOutputName('summary')).toBe(false)
  })
})

describe('buildCustomBlockConfig', () => {
  const fields: WorkflowInputField[] = [
    { name: 'title', type: 'string' },
    { name: 'count', type: 'number' },
    { name: 'flag', type: 'boolean' },
    { name: 'payload', type: 'object' },
    { name: 'items', type: 'array' },
    { name: 'docs', type: 'file[]' },
  ]

  it('advertises no data fields — and no whole-result fallback — without curation', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    // Curation is required at publish, so an uncurated row exposes only the
    // system fields. `result` must not come back: it would advertise the child's
    // raw terminal state (agent toolCalls/thinking, nested workflow ids).
    expect(Object.keys(config.outputs).sort()).toEqual([
      'error',
      'errorRef',
      'errorType',
      'success',
    ])
    expect(config.outputs.result).toBeUndefined()
    expect(config.outputs.childWorkflowId).toBeUndefined()
    expect(config.outputs.childTraceSpans).toBeUndefined()
  })

  it('assembles inputMapping from non-reserved, non-empty params', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    const mappingFn = findSub(config, 'inputMapping')?.value
    const json = mappingFn?.({
      workflowId: 'wf-1',
      inputMapping: 'ignored',
      triggerMode: true,
      title: 'Acme',
      count: 3,
      empty: '',
    })
    expect(JSON.parse(json as string)).toEqual({ title: 'Acme', count: 3 })
  })
})

describe('assembleCustomBlockInputMapping', () => {
  const fieldSubBlocks = [
    { id: 'flag', name: 'flag', type: 'boolean' },
    { id: 'payload', name: 'payload', type: 'object' },
    { id: 'name', name: 'name', type: 'string' },
  ]

  it("decodes a tool row's stringified boolean before handing it to the child", () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: 'false' }, fieldSubBlocks))).toEqual({
      flag: false,
    })
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: 'true' }, fieldSubBlocks))).toEqual({
      flag: true,
    })
  })

  it('leaves a text field alone even when it holds a boolean-looking string', () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ name: 'false' }, fieldSubBlocks))).toEqual({
      name: 'false',
    })
  })
})

describe('assembleCustomBlockInputMapping field decoding', () => {
  const inputFields = [
    { id: 'flag', name: 'flag', type: 'boolean' },
    { id: 'count', name: 'count', type: 'number' },
    { id: 'body', name: 'body', type: 'object' },
    { id: 'note', name: 'note', type: 'string' },
  ]

  it('decodes on the DECLARED field type, not the control it renders as', () => {
    // `number` collects in a text field and `object` in a code editor — both store
    // strings, so keying on the control would decode neither.
    expect(
      JSON.parse(
        assembleCustomBlockInputMapping(
          { flag: 'false', count: '3', body: '{"a":1}', note: 'false' },
          inputFields
        )
      )
    ).toEqual({ flag: false, count: 3, body: { a: 1 }, note: 'false' })
  })
})
