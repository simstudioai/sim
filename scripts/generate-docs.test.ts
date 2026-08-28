import { describe, expect, it } from 'vitest'
import {
  extractToolInfo,
  getToolInfo,
  parseConstProperties,
  parsePropertiesContent,
} from './generate-docs'

describe('documentation tool metadata', () => {
  it('keeps legitimate parameters named params', async () => {
    const tool = await getToolInfo('supabase_rpc')

    expect(tool?.params.map(({ name }) => name)).toContain('params')
  })

  it('does not render operation model-input metadata as a parameter', async () => {
    const tool = await getToolInfo('elevenlabs_sound_effects')

    expect(tool?.params.map(({ name }) => name)).not.toContain('modelInput')
  })

  it('documents Reducto table format values using their wire identifiers', async () => {
    const tool = await getToolInfo('reducto_parser_v2')

    expect(tool?.params.find(({ name }) => name === 'tableOutputFormat')).toMatchObject({
      description: 'Table output format (`md` for Markdown or `html` for HTML). Defaults to `md`.',
    })
  })

  it('documents only the URL and headers accepted by File Fetch', async () => {
    const tool = await getToolInfo('file_fetch')

    expect(tool?.params).toEqual([
      {
        name: 'fileUrl',
        type: 'string',
        required: true,
        description: 'URL of the file to fetch and parse.',
      },
      {
        name: 'headers',
        type: 'object',
        required: false,
        description: 'HTTP headers to include when fetching URL-based files.',
      },
    ])
  })

  it('uses evaluated descriptions instead of emitting source concatenation syntax', async () => {
    const tool = await getToolInfo('sendgrid_list_templates')

    expect(tool?.params.find(({ name }) => name === 'pageSize')?.description).toBe(
      'Number of templates to return per page (default: 20, max: 200). When paginating with pageToken, pass the same pageSize used on the first request to keep page boundaries consistent.'
    )
  })

  it('uses evaluated constants instead of emitting template expressions', async () => {
    const tool = await getToolInfo('table_batch_insert_rows')

    expect(tool?.description).toBe('Insert multiple rows into a table at once (up to 1000 rows)')
    expect(tool?.params.find(({ name }) => name === 'rows')?.description).toBe(
      'Array of row data objects (max 1000 rows)'
    )
  })
})

describe('documentation input parameter parsing', () => {
  it('stops at operation metadata', () => {
    const tool = extractToolInfo(
      'example_generate',
      `
        export const exampleTool = {
          id: 'example_generate',
          description: 'Generate an example',
          params: {
            prompt: {
              type: 'string',
              required: true,
              description: 'The prompt',
            },
          },
          operation: {
            modelInput: {
              mode: 'project',
              select: (params) => ({ prompt: params.prompt }),
            },
            secretProvenance: {
              inputPaths: ['prompt'],
            },
            input: (params) => ({
              body: { prompt: params.prompt },
            }),
          },
          outputs: {},
        }
      `
    )

    expect(tool?.params).toEqual([
      {
        name: 'prompt',
        type: 'string',
        required: true,
        description: 'The prompt',
      },
    ])
  })

  it('stops at legacy request metadata after a comment', () => {
    const tool = extractToolInfo(
      'example_send',
      `
        export const exampleTool = {
          id: 'example_send',
          description: 'Send an example',
          params: {
            message: {
              type: 'string',
              required: true,
              description: 'The message',
            },
          },
          // Direct execution short-circuits this legacy request descriptor.
          request: {
            url: () => '',
            method: 'POST',
            modelInput: {
              mode: 'project',
              select: (params) => ({ message: params.message }),
            },
          },
          directExecution: async () => ({ success: true }),
          outputs: {},
        }
      `
    )

    expect(tool?.params.map(({ name }) => name)).toEqual(['message'])
  })
})

describe('documentation output property parsing', () => {
  it('keeps a response field named items inside an array element', () => {
    const properties = parsePropertiesContent(`
      vaults: {
        type: 'array',
        description: 'List of accessible vaults',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Vault ID' },
            items: { type: 'number', description: 'Number of items in the vault' },
          },
        },
      },
    `)

    expect(Object.keys(properties)).toEqual(['vaults'])
    expect(properties.vaults.items.properties.items).toEqual({
      type: 'number',
      description: 'Number of items in the vault',
    })
  })

  it('keeps a response field named items that directly references a constant', () => {
    const properties = parsePropertiesContent('items: ATTENDEES_OUTPUT,', 'calcom')

    expect(properties.items).toMatchObject({
      type: 'array',
      description: 'List of attendees',
    })
  })

  it('keeps a response field named items that references a constant property', () => {
    const properties = parsePropertiesContent('items: EVENT_TYPE_OUTPUT_PROPERTIES.id,', 'calcom')

    expect(properties.items).toEqual({
      type: 'number',
      description: 'Event type ID',
    })
  })

  it('keeps items fields in constant-defined property maps', () => {
    const typesContent = `
      export const RECORD_OUTPUT_PROPERTIES = {
        id: { type: 'string', description: 'Record ID' },
      }
    `
    const properties = parseConstProperties(
      `
        items: {
          type: 'object',
          description: 'Result page',
          properties: {
            object: { type: 'string', description: 'Page type' },
            data: {
              type: 'array',
              description: 'Result records',
              items: { type: 'object', properties: RECORD_OUTPUT_PROPERTIES },
            },
            hasMore: { type: 'boolean', description: 'Whether more results exist' },
          },
        },
      `,
      'test',
      typesContent,
      0
    )

    expect(Object.keys(properties)).toEqual(['items'])
    expect(Object.keys(properties.items.properties)).toEqual(['object', 'data', 'hasMore'])
    expect(properties.items.properties.data.items.properties.id).toEqual({
      type: 'string',
      description: 'Record ID',
    })
  })
})
