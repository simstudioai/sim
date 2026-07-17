import { describe, expect, it } from 'vitest'
import { buildInterfaceExecuteResponse } from '@/lib/interfaces/compiler/output-response'
import { buildExecutePayload } from '@/lib/interfaces/compiler/render-payload'
import { resolveApiStartInput } from '@/lib/interfaces/spec/api-start-input'
import { toPublicInterfaceDto } from '@/lib/interfaces/spec/public-view'
import {
  INTERFACE_RESERVED_IDENTIFIERS,
  interfaceSpecSchema,
  isReservedInterfaceIdentifier,
} from '@/lib/interfaces/spec/schema'
import { validateInterfaceSpec } from '@/lib/interfaces/spec/validate'

const buttonOnlySpec = {
  version: 1 as const,
  theme: { primaryColor: '#112233' },
  page: { title: 'Send hi' },
  sections: [],
  actions: [
    {
      id: 'run',
      label: 'Send',
      variant: 'primary' as const,
      submit: { fieldMapping: {} },
    },
  ],
  messages: { success: 'Sent!' },
}

describe('interfaceSpecSchema', () => {
  it('accepts a button-only spec', () => {
    const parsed = interfaceSpecSchema.safeParse(buttonOnlySpec)
    expect(parsed.success).toBe(true)
  })

  it('rejects multiple actions', () => {
    const parsed = interfaceSpecSchema.safeParse({
      ...buttonOnlySpec,
      actions: [buttonOnlySpec.actions[0], { ...buttonOnlySpec.actions[0], id: 'run2' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('reserves static identifier segments', () => {
    expect(isReservedInterfaceIdentifier('generate')).toBe(true)
    expect(INTERFACE_RESERVED_IDENTIFIERS.has('validate')).toBe(true)
    expect(isReservedInterfaceIdentifier('my-form')).toBe(false)
  })
})

describe('resolveApiStartInput', () => {
  it('resolves unified start and empty inputFormat', () => {
    const result = resolveApiStartInput({
      start: {
        type: 'start_trigger',
        subBlocks: { inputFormat: { value: [] } },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.fields).toEqual([])
    }
  })

  it('rejects legacy starter in chat mode', () => {
    const result = resolveApiStartInput({
      starter: {
        type: 'starter',
        subBlocks: {
          startWorkflow: { value: 'chat' },
          inputFormat: { value: [] },
        },
      },
    })
    expect(result.ok).toBe(false)
  })

  it('derives requiredness without exposing defaults to llm fields', () => {
    const result = resolveApiStartInput({
      start: {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'subject', type: 'string', value: 'hi' },
              { name: 'count', type: 'number' },
            ],
          },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.fields.find((f) => f.name === 'subject')?.required).toBe(false)
      expect(result.data.fields.find((f) => f.name === 'count')?.required).toBe(true)
    }
  })

  it('rejects file[] inputs', () => {
    const result = resolveApiStartInput({
      start: {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [{ name: 'docs', type: 'file[]' }],
          },
        },
      },
    })
    expect(result.ok).toBe(false)
  })
})

describe('validateInterfaceSpec', () => {
  it('validates a form bound to start fields', () => {
    const result = validateInterfaceSpec(
      {
        version: 1,
        sections: [
          {
            id: 'main',
            controls: [
              {
                type: 'text',
                id: 'subject',
                label: 'Subject',
                required: true,
                bind: 'subject',
              },
              {
                type: 'checkbox',
                id: 'notify',
                label: 'Notify',
                bind: 'notify',
              },
              {
                type: 'select',
                id: 'priority',
                label: 'Priority',
                bind: 'priority',
                options: [
                  { label: 'Low', value: 'low' },
                  { label: 'High', value: 'high' },
                ],
              },
              {
                type: 'number',
                id: 'count',
                label: 'Count',
                required: true,
                bind: 'count',
              },
            ],
          },
        ],
        actions: [
          {
            id: 'run',
            label: 'Run',
            submit: { fieldMapping: {} },
          },
        ],
      },
      [
        { name: 'subject', type: 'string', required: true },
        { name: 'notify', type: 'boolean', required: false },
        { name: 'priority', type: 'string', required: false },
        { name: 'count', type: 'number', required: true },
      ]
    )
    expect(result.success).toBe(true)
  })

  it('rejects unbound required fields', () => {
    const result = validateInterfaceSpec(buttonOnlySpec, [
      { name: 'subject', type: 'string', required: true },
    ])
    expect(result.success).toBe(false)
  })

  it('forces required flags from the API schema (including clearing LLM mistakes)', () => {
    const result = validateInterfaceSpec(
      {
        version: 1,
        sections: [
          {
            id: 'main',
            controls: [
              {
                type: 'text',
                id: 'subject',
                label: 'Subject',
                bind: 'subject',
                // LLM omitted required
              },
              {
                type: 'text',
                id: 'note',
                label: 'Note',
                bind: 'note',
                required: true, // LLM incorrectly marked optional field required
              },
            ],
          },
        ],
        actions: [{ id: 'run', label: 'Go', submit: { fieldMapping: { subject: 'other' } } }],
      },
      [
        { name: 'subject', type: 'string', required: true },
        { name: 'note', type: 'string', required: false },
      ]
    )
    expect(result.success).toBe(true)
    const [subject, note] = result.spec!.sections[0].controls
    expect(subject.type).not.toBe('markdown')
    expect(note.type).not.toBe('markdown')
    if (subject.type !== 'markdown') expect(subject.required).toBe(true)
    if (note.type !== 'markdown') expect(note.required).toBe(false)
    // fieldMapping is derived from bind, ignoring LLM remaps
    expect(result.spec!.actions[0].submit.fieldMapping).toEqual({
      subject: 'subject',
      note: 'note',
    })
  })
})

describe('toPublicInterfaceDto', () => {
  it('strips binds and fieldMapping', () => {
    const validated = validateInterfaceSpec(
      {
        version: 1,
        sections: [
          {
            id: 'main',
            controls: [
              { type: 'text', id: 'subject', label: 'Subject', bind: 'subject', required: true },
            ],
          },
        ],
        actions: [{ id: 'run', label: 'Go', submit: { fieldMapping: { subject: 'subject' } } }],
      },
      [{ name: 'subject', type: 'string', required: true }]
    )
    expect(validated.spec).toBeTruthy()
    const dto = toPublicInterfaceDto(
      { title: 'My UI', description: 'Desc', primaryColor: '#abc' },
      validated.spec!
    )
    expect(dto.title).toBe('My UI')
    expect(JSON.stringify(dto)).not.toContain('fieldMapping')
    expect(JSON.stringify(dto)).not.toContain('"bind"')
    expect(dto.actions[0]).toEqual({ id: 'run', label: 'Go', variant: 'primary' })
  })
})

describe('buildExecutePayload', () => {
  it('maps values and omits untouched optionals', () => {
    const validated = validateInterfaceSpec(
      {
        version: 1,
        sections: [
          {
            id: 'main',
            controls: [
              { type: 'text', id: 'subject', label: 'Subject', bind: 'subject', required: true },
              { type: 'text', id: 'note', label: 'Note', bind: 'note' },
            ],
          },
        ],
        actions: [{ id: 'run', label: 'Go', submit: { fieldMapping: {} } }],
      },
      [
        { name: 'subject', type: 'string', required: true },
        { name: 'note', type: 'string', required: false },
      ]
    )
    const result = buildExecutePayload(validated.spec!, 'run', { subject: 'Hello' })
    expect(result.success).toBe(true)
    expect(result.payload).toEqual({ subject: 'Hello' })
  })

  it('rejects unknown actions and tampered controls', () => {
    const validated = validateInterfaceSpec(buttonOnlySpec, [])
    expect(buildExecutePayload(validated.spec!, 'nope', {}).success).toBe(false)
    expect(buildExecutePayload(validated.spec!, 'run', { hacked: 'x' }).success).toBe(false)
  })
})

describe('buildInterfaceExecuteResponse', () => {
  it('returns success-only when no outputConfigs', () => {
    expect(
      buildInterfaceExecuteResponse({
        success: true,
        resultOutput: { secret: true },
        outputConfigs: [],
      })
    ).toEqual({ success: true })
  })

  it('returns selected outputs only', () => {
    const response = buildInterfaceExecuteResponse({
      success: true,
      blockOutputs: {
        agent1: { content: 'hi' },
      },
      outputConfigs: [{ blockId: 'agent1', path: 'content' }],
    })
    expect(response).toEqual({
      success: true,
      output: 'hi',
    })
  })
})
