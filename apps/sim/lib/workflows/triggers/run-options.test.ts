import { describe, expect, it } from 'vitest'
import {
  resolveTriggerRunOptions,
  type TriggerInputKind,
  type TriggerRunOption,
  validateTriggerInput,
} from '@/lib/workflows/triggers/run-options'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import { buildStartBlockOutput } from '@/executor/utils/start-block'
import type { SerializedBlock } from '@/serializer/types'

function makeOption(overrides: Partial<TriggerRunOption>): TriggerRunOption {
  const inputKind: TriggerInputKind = overrides.inputKind ?? 'fields'
  return {
    triggerBlockId: 'blk_1',
    blockName: 'Test Trigger',
    triggerType: 'api_trigger',
    path: StartBlockPath.SPLIT_API,
    isDefault: true,
    inputKind,
    inputSchema: { type: 'object' },
    mockPayload: {},
    inputFormat: [],
    ...overrides,
  }
}

const fields = (...f: InputFormatField[]): InputFormatField[] => f

describe('file inputs through workflow run options', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const file = {
    id: 'file-1',
    name: 'photo.png',
    url: 'https://storage.example.com/photo.png',
    type: 'image/png',
    size: 128,
    key: `workspace/${workspaceId}/photo.png`,
    context: 'workspace',
  }
  const inputFormat = fields(
    { name: 'input', type: 'string', value: '' },
    { name: 'conversationId', type: 'string', value: '' },
    { name: 'files', type: 'file[]', value: '' }
  )
  const block = {
    type: 'start_trigger',
    name: 'Start',
    subBlocks: { inputFormat: { value: inputFormat } },
  }

  it('advertises and accepts attachments that survive Start normalization', () => {
    const [option] = resolveTriggerRunOptions({ start: block })
    expect(option.inputSchema).toMatchObject({ properties: { files: { type: 'array' } } })
    const workflowInput = { input: 'Rotate this image', conversationId: 'c1', files: [file] }
    expect(validateTriggerInput(option, workflowInput)).toEqual({ ok: true })

    const serialized: SerializedBlock = {
      id: 'start',
      position: { x: 0, y: 0 },
      config: { tool: 'start_trigger', params: { inputFormat } },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'start_trigger', name: 'Start', category: 'triggers' },
    }
    const output = buildStartBlockOutput({
      resolution: { blockId: 'start', block: serialized, path: option.path },
      workspaceId,
      workflowInput,
    })
    expect(output.files).toEqual([file])
    expect(output.input).toBe('Rotate this image')
  })

  it('rejects text attachments before execution with an actionable field error', () => {
    const [option] = resolveTriggerRunOptions({ start: block })
    const result = validateTriggerInput(option, { files: JSON.stringify([file]) })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('files')
    expect(result.error).toContain('expected array')
  })

  it('generates valid mock input from empty file defaults', () => {
    const [option] = resolveTriggerRunOptions({ start: block })
    expect(option.mockPayload).toMatchObject({ files: [] })
    expect(validateTriggerInput(option, option.mockPayload)).toEqual({ ok: true })
  })

  it('preserves uploaded files stored as JSON in editor defaults', () => {
    const [option] = resolveTriggerRunOptions({
      start: {
        ...block,
        subBlocks: {
          inputFormat: {
            value: [{ name: 'files', type: 'file[]', value: JSON.stringify([file]) }],
          },
        },
      },
    })
    expect(option.mockPayload).toEqual({ files: [file] })
    expect(validateTriggerInput(option, option.mockPayload)).toEqual({ ok: true })
  })
})

describe('validateTriggerInput', () => {
  describe('fields', () => {
    it('accepts input that provides all declared fields with correct types', () => {
      const option = makeOption({
        inputFormat: fields({ name: 'city', type: 'string' }, { name: 'days', type: 'number' }),
      })
      expect(validateTriggerInput(option, { city: 'SF', days: 3 }).ok).toBe(true)
    })

    it('rejects a missing required field (no default)', () => {
      const option = makeOption({ inputFormat: fields({ name: 'city', type: 'string' }) })
      const result = validateTriggerInput(option, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('city')
    })

    it('treats a field with an author default as optional (matches executor)', () => {
      const option = makeOption({
        inputFormat: fields(
          { name: 'city', type: 'string' },
          { name: 'limit', type: 'number', value: 10 }
        ),
      })
      // limit omitted -> still valid because the workflow defaults it
      expect(validateTriggerInput(option, { city: 'SF' }).ok).toBe(true)
    })

    it('rejects a wrong field type', () => {
      const option = makeOption({ inputFormat: fields({ name: 'days', type: 'number' }) })
      expect(validateTriggerInput(option, { days: 'three' }).ok).toBe(false)
    })

    it('rejects unknown keys for non-UNIFIED triggers', () => {
      const option = makeOption({
        path: StartBlockPath.SPLIT_API,
        inputFormat: fields({ name: 'city', type: 'string' }),
      })
      expect(validateTriggerInput(option, { city: 'SF', extra: 1 }).ok).toBe(false)
    })

    it('allows passthrough keys for UNIFIED start blocks', () => {
      const option = makeOption({
        path: StartBlockPath.UNIFIED,
        triggerType: 'start_trigger',
        inputFormat: fields({ name: 'city', type: 'string' }),
      })
      expect(validateTriggerInput(option, { city: 'SF', files: [], conversationId: 'c1' }).ok).toBe(
        true
      )
    })

    it('accepts an empty object when the trigger declares no fields', () => {
      const option = makeOption({ inputFormat: [] })
      expect(validateTriggerInput(option, {}).ok).toBe(true)
      expect(validateTriggerInput(option, undefined).ok).toBe(true)
    })

    it('rejects non-object input when fields are declared', () => {
      const option = makeOption({ inputFormat: fields({ name: 'city', type: 'string' }) })
      expect(validateTriggerInput(option, 'SF').ok).toBe(false)
    })
  })

  describe('event_payload', () => {
    const option = makeOption({
      inputKind: 'event_payload',
      path: StartBlockPath.EXTERNAL_TRIGGER,
      triggerType: 'gmail',
    })

    it('accepts a non-empty object', () => {
      expect(validateTriggerInput(option, { email: { from: 'a@b.com' } }).ok).toBe(true)
    })

    it('rejects an empty object', () => {
      expect(validateTriggerInput(option, {}).ok).toBe(false)
    })

    it('rejects missing/non-object input', () => {
      expect(validateTriggerInput(option, undefined).ok).toBe(false)
      expect(validateTriggerInput(option, []).ok).toBe(false)
    })
  })

  describe('chat', () => {
    const option = makeOption({
      inputKind: 'chat',
      path: StartBlockPath.SPLIT_CHAT,
      triggerType: 'chat_trigger',
    })

    it('accepts a non-empty input string', () => {
      expect(validateTriggerInput(option, { input: 'hello' }).ok).toBe(true)
    })

    it('rejects empty or missing input', () => {
      expect(validateTriggerInput(option, {}).ok).toBe(false)
      expect(validateTriggerInput(option, { input: '' }).ok).toBe(false)
    })
  })

  describe('none', () => {
    const option = makeOption({
      inputKind: 'none',
      path: StartBlockPath.EXTERNAL_TRIGGER,
      triggerType: 'schedule',
    })

    it('accepts any input (no input required)', () => {
      expect(validateTriggerInput(option, undefined).ok).toBe(true)
      expect(validateTriggerInput(option, { anything: 1 }).ok).toBe(true)
    })
  })
})
