import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'
import { generateToolInputSchema } from '@/lib/mcp/workflow-tool-schema'
import { generateWorkflowInputShape } from '@/lib/workflows/input-schema'
import type { InputFormatField } from '@/lib/workflows/types'

const file = {
  id: 'image-1',
  name: 'photo.png',
  url: 'https://storage.example.com/photo.png',
  size: 128,
  type: 'image/png',
  key: 'workspace/workspace-1/photo.png',
  context: 'workspace',
}

const inputFormat: InputFormatField[] = [
  { name: 'input', type: 'string', value: '' },
  { name: 'conversationId', type: 'string', value: '' },
  { name: 'files', type: 'file[]', value: '' },
]

const schema = z.object(generateWorkflowInputShape(inputFormat))

describe('workflow input schemas', () => {
  it('advertises uploaded file objects and validates them without stripping metadata', () => {
    const advertised = generateToolInputSchema(inputFormat)
    expect(advertised.properties?.files).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'url', 'size', 'type', 'key'],
        properties: {
          key: { type: 'string' },
          type: { type: 'string' },
        },
      },
    })
    const input = { input: 'Rotate the image', conversationId: 'conversation-1', files: [file] }
    expect(schema.parse(input)).toEqual(input)
  })

  it.each(['', '[]', JSON.stringify([file])])('rejects stringified files: %s', (files) => {
    expect(schema.safeParse({ files }).success).toBe(false)
  })

  it('allows empty attachments and omitted fields with configured defaults', () => {
    expect(schema.parse({ files: [] })).toEqual({ files: [] })
    expect(schema.parse({})).toEqual({})
    expect(generateToolInputSchema(inputFormat).required).toBeUndefined()
  })

  it.each([
    { name: 'photo.png', data: 'base64', mimeType: 'image/png' },
    { ...file, id: undefined },
    { ...file, name: '' },
    { ...file, type: '' },
    { ...file, size: '128' },
    { ...file, key: undefined },
    { ...file, key: undefined, url: '/api/files/serve/' },
  ])('rejects file input that the Start block cannot consume: %j', (invalidFile) => {
    expect(schema.safeParse({ files: [invalidFile] }).success).toBe(false)
  })

  it.each([
    { value: file, valid: true },
    { value: { ...file, key: '' }, valid: false },
    { value: { ...file, key: undefined }, valid: false },
    {
      value: {
        ...file,
        key: undefined,
        url: `/api/files/serve/s3/${encodeURIComponent(file.key)}?context=workspace`,
      },
      valid: false,
    },
  ])('advertises the same storage-key requirement it validates: $valid', ({ value, valid }) => {
    const validate = compileMcpToolSchema(generateToolInputSchema(inputFormat))
    const input = { files: [value] }
    expect(validate(input)).toBe(valid)
    expect(schema.safeParse(input).success).toBe(valid)
  })

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects reserved input name %s before schema construction',
    (name) => {
      const fields: InputFormatField[] = [{ name, type: 'string' }]
      expect(() => generateWorkflowInputShape(fields)).toThrow('is reserved')
      expect(() => generateToolInputSchema(fields)).toThrow('is reserved')
    }
  )

  it('shares required fields, descriptions, and arbitrary array items across schemas', () => {
    const fields: InputFormatField[] = [
      { name: ' message ', type: 'string', description: ' User message ' },
      { name: 'count', type: 'number', value: 3 },
      { name: 'enabled', type: 'boolean' },
      { name: 'options', type: 'object' },
      { name: 'items', type: 'array' },
    ]
    const advertised = generateToolInputSchema(fields)
    expect(advertised.required).toEqual(['message', 'enabled', 'options', 'items'])
    expect(advertised.properties?.message).toEqual({ type: 'string', description: 'User message' })
    expect(advertised.properties?.items).toMatchObject({ type: 'array', items: {} })
    const input = {
      message: 'hello',
      enabled: true,
      options: { nested: [1] },
      items: [1, { a: true }],
    }
    expect(z.object(generateWorkflowInputShape(fields)).parse(input)).toEqual(input)
  })

  it('rejects unsupported type names instead of advertising strings', () => {
    expect(() => generateToolInputSchema([{ name: 'files', type: 'files' }])).toThrow(
      'Unsupported workflow input type "files"'
    )
  })
})
