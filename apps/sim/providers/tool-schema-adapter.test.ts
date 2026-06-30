/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  adaptAnthropicToolSchema,
  adaptOpenAIChatToolSchema,
} from '@/providers/tool-schema-adapter'
import type { ProviderToolConfig } from '@/providers/types'

const sampleTool: ProviderToolConfig = {
  id: 'search_web',
  name: 'Search Web',
  description: 'Search the web for a query',
  params: {},
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The query' } },
    required: ['query'],
  },
}

const noDescriptionTool: ProviderToolConfig = {
  id: 'noop',
  name: 'Noop',
  description: '',
  params: {},
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
}

const emptyParametersTool: ProviderToolConfig = {
  id: 'ping',
  name: 'Ping',
  description: 'Ping the server',
  params: {},
  parameters: {} as ProviderToolConfig['parameters'],
}

describe('adaptOpenAIChatToolSchema', () => {
  it('wraps the tool in the chat function shape', () => {
    expect(adaptOpenAIChatToolSchema(sampleTool)).toEqual({
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for a query',
        parameters: sampleTool.parameters,
      },
    })
  })

  it('preserves an empty description', () => {
    expect(adaptOpenAIChatToolSchema(noDescriptionTool)).toEqual({
      type: 'function',
      function: {
        name: 'noop',
        description: '',
        parameters: noDescriptionTool.parameters,
      },
    })
  })

  it('passes through empty parameters unchanged', () => {
    expect(adaptOpenAIChatToolSchema(emptyParametersTool)).toEqual({
      type: 'function',
      function: {
        name: 'ping',
        description: 'Ping the server',
        parameters: emptyParametersTool.parameters,
      },
    })
  })
})

describe('adaptAnthropicToolSchema', () => {
  it('produces the Anthropic input_schema shape', () => {
    expect(adaptAnthropicToolSchema(sampleTool)).toEqual({
      name: 'search_web',
      description: 'Search the web for a query',
      input_schema: {
        type: 'object',
        properties: sampleTool.parameters.properties,
        required: sampleTool.parameters.required,
      },
    })
  })

  it('preserves an empty description', () => {
    expect(adaptAnthropicToolSchema(noDescriptionTool)).toEqual({
      name: 'noop',
      description: '',
      input_schema: {
        type: 'object',
        properties: noDescriptionTool.parameters.properties,
        required: noDescriptionTool.parameters.required,
      },
    })
  })

  it('passes through empty parameters as undefined properties/required', () => {
    expect(adaptAnthropicToolSchema(emptyParametersTool)).toEqual({
      name: 'ping',
      description: 'Ping the server',
      input_schema: {
        type: 'object',
        properties: undefined,
        required: undefined,
      },
    })
  })
})
