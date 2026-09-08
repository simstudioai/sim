import fs from 'fs'
import path from 'path'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import {
  escapeMdxCell,
  extractAllBlockConfigs,
  extractBlockSuppliedParamIds,
  extractInheritedBlockCategory,
  extractToolInfo,
  extractUserSettableParamIds,
  generateIconMappings,
  getToolInfo,
  parseConstProperties,
  parsePropertiesContent,
} from './generate-docs'

describe('documentation editor icon metadata', () => {
  it('keeps core icons and inherited categories out of the integration catalog', async () => {
    const { docs, visible, coreBlockTypes } = await generateIconMappings()
    expect(docs.wait.name).toBe('CirclePause')
    expect(docs.schedule.name).toBe('Clock')
    expect(docs.generic_webhook.name).toBe('Webhook')
    expect(coreBlockTypes).toEqual(
      expect.arrayContaining(['agent', 'file_v5', 'human_in_the_loop_v2'])
    )
    expect(visible.agent).toBeUndefined()
    expect(visible.wait).toBeUndefined()
    expect(visible.generic_webhook).toBeUndefined()
  })

  it('resolves nested inheritance, honors overrides, and stops at cycles', () => {
    const source = `
      export const BaseBlock: BlockConfig = { category: 'blocks' }
      export const NextBlock: BlockConfig = {
        ...BaseBlock,
      }
      export const CycleBlock: BlockConfig = {
        ...CycleBlock,
      }
    `
    expect(extractInheritedBlockCategory('{\n ...NextBlock,\n}', source)).toBe('blocks')
    expect(extractInheritedBlockCategory("{\n ...NextBlock,\n category: 'tools'\n}", source)).toBe(
      'tools'
    )
    expect(extractInheritedBlockCategory('{\n ...CycleBlock,\n}', source)).toBeNull()
  })
})

describe('documentation tool metadata', () => {
  it('uses evaluated outputs for factory-defined tools', async () => {
    const approve = await getToolInfo('sailpoint_approve_access_request')
    const identity = await getToolInfo('sailpoint_get_identity')

    expect(Object.keys(approve?.outputs ?? {})).toEqual(['accepted', 'status'])
    expect(Object.keys(identity?.outputs ?? {})).toEqual(['identity'])
    expect(identity?.outputs.identity.properties).toHaveProperty('name')
  }, 15_000)

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

  /**
   * Pins the hidden-param filter on the source-parsing path in {@link extractToolInfo}. Tools
   * with an entry in tool-metadata.ts never reach it, so it must be driven with synthetic
   * source rather than through `getToolInfo`. Without this the filter can be deleted outright
   * and the whole suite stays green.
   */
  describe('the hidden-param filter on the source-parsing path', () => {
    const source = `
        export const exampleTool = {
          id: 'example_send',
          description: 'Send an example',
          params: {
            message: {
              type: 'string',
              required: true,
              description: 'The message',
            },
            apiKey: {
              type: 'string',
              required: true,
              visibility: 'hidden',
              description: 'The API key the block injects',
            },
            instanceUrl: {
              type: 'string',
              required: true,
              visibility: 'hidden',
              description: 'Resolved from the credential',
            },
          },
          outputs: {},
        }
      `

    const paramNames = (ids: ReadonlySet<string> | null) =>
      extractToolInfo('example_send', source, '', '', '', ids)?.params.map(({ name }) => name)

    it('drops a hidden param the block does not supply', () => {
      expect(paramNames(new Set(['message']))).toEqual(['message'])
    })

    it('keeps a hidden param the block exposes as its own field', () => {
      expect(paramNames(new Set(['message', 'apiKey']))).toEqual(['message', 'apiKey'])
    })

    it('keeps every param when the block-supplied set is UNKNOWN', () => {
      expect(paramNames(null)).toEqual(['message', 'apiKey', 'instanceUrl'])
    })
  })

  it('stops at operation metadata after a comment', () => {
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
          operation: {
            input: (params) => params,
            modelInput: {
              mode: 'project',
              select: (params) => ({ message: params.message }),
            },
          },
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

describe('hidden tool params in the Input table', () => {
  const blockSource = (blockFile: string) =>
    fs.readFileSync(path.join(import.meta.dirname, '../apps/sim/blocks/blocks', blockFile), 'utf-8')

  const paramNames = async (toolId: string, blockFile: string) => {
    const info = await getToolInfo(toolId, extractUserSettableParamIds(blockSource(blockFile)))
    return info?.params.map((param) => param.name) ?? []
  }

  it('extracts the param ids a block exposes to the user', () => {
    const ids = extractUserSettableParamIds(blockSource('mailchimp.ts'))

    expect(ids).toContain('apiKey')
    expect(extractUserSettableParamIds(blockSource('jira.ts'))).not.toContain('cloudId')
  })

  it('keeps a hidden tool param the block exposes as a user-typed field', async () => {
    await expect(paramNames('mailchimp_add_member', 'mailchimp.ts')).resolves.toContain('apiKey')
  })

  it('drops hidden params the block never exposes', async () => {
    await expect(paramNames('jira_retrieve', 'jira.ts')).resolves.not.toContain('cloudId')
    await expect(paramNames('jira_write', 'jira.ts')).resolves.not.toContain('cloudId')

    const salesforce = await paramNames('salesforce_query', 'salesforce.ts')
    expect(salesforce).not.toContain('idToken')
    expect(salesforce).not.toContain('instanceUrl')

    await expect(paramNames('netsuite_execute_suiteql', 'netsuite.ts')).resolves.not.toContain(
      'instanceUrl'
    )
  })
})

describe('subBlock param extraction', () => {
  const blockSource = (blockFile: string) =>
    fs.readFileSync(path.join(import.meta.dirname, '../apps/sim/blocks/blocks', blockFile), 'utf-8')

  it('extracts ids from a block whose subBlocks array contains commented-out code', () => {
    const ids = extractUserSettableParamIds(blockSource('google_drive.ts'))

    expect(ids).toContain('operation')
    expect(ids).toContain('mimeType')
    expect(ids).toContain('fileName')
    expect(ids).toContain('uploadFolderSelector')
  })

  it('extracts ids past a commented-out subBlock that ends a line on an open bracket', () => {
    const ids = extractUserSettableParamIds(blockSource('human_in_the_loop.ts'))

    expect(ids).toContain('notification')
    expect(ids).toContain('inputFormat')
  })

  it('returns no ids for blocks whose subBlocks array is genuinely empty', () => {
    for (const blockFile of ['chat_trigger.ts', 'manual_trigger.ts']) {
      expect(extractUserSettableParamIds(blockSource(blockFile))).toEqual([])
    }
  })

  /**
   * The spreads name fields arrays this scanner never follows, so what the block supplies is
   * UNKNOWN. Answering `[]` asserts the block supplies nothing, and the hidden-param filter
   * reads that as licence to strip every hidden param from every tool the block owns — silently,
   * with no `parseError` and so no warning. `NotionV2Block` has exactly this shape and is only
   * harmless today because no `notion_*` tool carries a hidden param besides `accessToken`.
   */
  it('reports a subBlocks array of only unfollowable spreads as UNKNOWN, not empty', () => {
    for (const blockFile of ['imap.ts', 'generic_webhook.ts', 'rss.ts', 'sim_workspace_event.ts']) {
      expect(extractUserSettableParamIds(blockSource(blockFile))).toBeNull()
    }

    const supplied = extractBlockSuppliedParamIds(
      `subBlocks: [...NotionBlock.subBlocks],`,
      'NotionV2'
    )
    expect(supplied.ids).toBeNull()
    expect(supplied.parseError).toBeNull()
  })

  it('still returns the inline ids when a spread sits alongside them', () => {
    expect(
      extractUserSettableParamIds(`subBlocks: [...Base.subBlocks, { id: 'operation' }],`)
    ).toEqual(['operation'])
  })

  it('ignores an id inside a comment or string literal at the top level of a subBlock', () => {
    expect(
      extractUserSettableParamIds(`subBlocks: [\n  { // id: 'ghost',\n    id: 'real' },\n],`)
    ).toEqual(['real'])

    expect(
      extractUserSettableParamIds(
        `subBlocks: [\n  { placeholder: "id: 'ghost'",\n    id: 'real' },\n],`
      )
    ).toEqual(['real'])

    expect(
      extractUserSettableParamIds(
        `subBlocks: [\n  { placeholder: "canonicalParamId: 'ghost'",\n    id: 'real',\n    canonicalParamId: 'canonical' },\n],`
      )
    ).toEqual(['real', 'canonical'])
  })

  it('throws when the subBlocks array holds literal objects but yields no ids', () => {
    expect(() =>
      extractUserSettableParamIds(`subBlocks: [\n  { title: 'No id here' },\n],`)
    ).toThrow(/subBlocks/)
  })

  it('throws when the subBlocks array bracket scan fails', () => {
    expect(() => extractUserSettableParamIds(`subBlocks: [\n  { id: 'operation' },\n`)).toThrow(
      /subBlocks/
    )
  })

  /**
   * Shapes taken verbatim from the blocks that ship them: `SlackV2Block`,
   * `VideoGeneratorV3Block`, `NotionV2Block` and `LinearV2Block`.
   */
  describe('subBlocks shapes the array-literal scan cannot walk', () => {
    it('reports a subBlocks value that is not an array literal at all', () => {
      expect(() =>
        extractUserSettableParamIds(
          `subBlocks: withFalAIModelOptions(VideoGeneratorV2Block.subBlocks, MODELS),`,
          'VideoGeneratorV3'
        )
      ).toThrow(/VideoGeneratorV3: subBlocks/)
    })

    it('reports an array whose only element is a bare helper call', () => {
      expect(() =>
        extractUserSettableParamIds(
          `subBlocks: [...getSlackV2ActionSubBlocks(), ...getTrigger('slack_oauth').subBlocks],`,
          'SlackV2'
        )
      ).toThrow(/SlackV2: subBlocks/)
    })

    /**
     * The elements name fields arrays, so the array parsed fine and there is nothing to warn
     * about — but this scanner never follows a spread, so the fields are UNKNOWN rather than
     * absent. `[]` would be a confident wrong answer that strips every hidden param the block's
     * tools declare.
     */
    it('reports an array of nothing but named fields arrays as UNKNOWN', () => {
      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...NotionBlock.subBlocks,\n  ...getTrigger('notion_page_created').subBlocks,\n],`,
          'NotionV2'
        )
      ).toBeNull()

      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...LinearBlock.subBlocks.filter((sb) => !sb.id?.startsWith('webhookSecret')),\n],`,
          'LinearV2'
        )
      ).toBeNull()
    })

    it('does not fail a block that overrides a spread subBlock instead of naming an id', () => {
      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...Base.subBlocks.map((sb) => (sb.id === 'x' ? { ...sb, required: true } : sb)),\n],`,
          'OverridingV2'
        )
      ).toBeNull()
    })

    it('leaves a readable array alone even when it also spreads an opaque helper', () => {
      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...SERVICE_ACCOUNT_SUBBLOCKS,\n  { id: 'operation' },\n],`,
          'GoogleDrive'
        )
      ).toEqual(['operation'])
    })
  })
})

describe('hidden params supplied by the block mapper', () => {
  const blockSource = (blockFile: string) =>
    fs.readFileSync(path.join(import.meta.dirname, '../apps/sim/blocks/blocks', blockFile), 'utf-8')

  const paramNames = async (toolId: string, blockFile: string) => {
    const info = await getToolInfo(toolId, extractBlockSuppliedParamIds(blockSource(blockFile)).ids)
    return info?.params.map((param) => param.name) ?? []
  }

  it("keeps Cal.com's required attendee, assembled as result.attendee in the mapper", async () => {
    expect(extractBlockSuppliedParamIds(blockSource('calcom.ts')).ids).toContain('attendee')
    await expect(paramNames('calcom_create_booking', 'calcom.ts')).resolves.toContain('attendee')
  })

  it("keeps JSM's workspaceId, renamed from assetWorkspaceId in the mapper", async () => {
    expect(extractBlockSuppliedParamIds(blockSource('jira_service_management.ts')).ids).toContain(
      'workspaceId'
    )
    await expect(
      paramNames('jsm_list_object_schemas', 'jira_service_management.ts')
    ).resolves.toContain('workspaceId')
  })

  it('keeps the file params Textract renames from its document field', async () => {
    const ids = extractBlockSuppliedParamIds(blockSource('textract.ts')).ids
    expect(ids).toContain('file')
    expect(ids).toContain('fileBack')
    expect(ids).toContain('filePathBack')

    const params = await paramNames('textract_analyze_id', 'textract.ts')
    expect(params).toContain('file')
    expect(params).toContain('fileBack')
    expect(params).toContain('filePathBack')
  })

  it('keeps the Mistral parser file param, so its Input table is not empty', async () => {
    await expect(paramNames('mistral_parser_v3', 'mistral_parse.ts')).resolves.toContain('file')
  })

  it('still drops resolver-derived hidden params with no user surface', async () => {
    await expect(paramNames('jira_retrieve', 'jira.ts')).resolves.not.toContain('cloudId')
    await expect(
      paramNames('jsm_list_object_schemas', 'jira_service_management.ts')
    ).resolves.not.toContain('cloudId')

    const salesforce = await paramNames('salesforce_query', 'salesforce.ts')
    expect(salesforce).not.toContain('idToken')
    expect(salesforce).not.toContain('instanceUrl')

    await expect(paramNames('netsuite_execute_suiteql', 'netsuite.ts')).resolves.not.toContain(
      'instanceUrl'
    )
    await expect(paramNames('snowflake_execute_sql', 'snowflake.ts')).resolves.not.toContain(
      'domain'
    )
    await expect(paramNames('pipedrive_get_deal', 'pipedrive.ts')).resolves.not.toContain(
      'authStyle'
    )
    await expect(paramNames('zoho_desk_list_tickets', 'zoho-desk.ts')).resolves.not.toContain(
      'apiDomain'
    )
  })

  it('finds the real mapper past a decoy params key that is not a mapper', () => {
    const { ids } = extractBlockSuppliedParamIds(`
      subBlocks: [{ id: 'operation' }],
      tools: {
        config: {
          params: (GitHubBlock.tools?.config as any)?.params,
          params: (params) => ({ renamed: params.original }),
        },
      },
    `)
    expect(ids).toContain('renamed')
  })

  it('reads an async mapper body', () => {
    const { ids } = extractBlockSuppliedParamIds(`
      subBlocks: [{ id: 'operation' }],
      tools: {
        config: {
          params: async (params) => ({ renamed: params.original }),
        },
      },
    `)
    expect(ids).toContain('renamed')
  })

  it('ignores a commented-out mapper assignment', () => {
    const { ids } = extractBlockSuppliedParamIds(`
      subBlocks: [{ id: 'operation' }],
      tools: {
        config: {
          params: (params) => {
            const result: Record<string, unknown> = {}
            // result.commentedOut = params.nope
            result.realOne = params.yes
            return result
          },
        },
      },
    `)
    expect(ids).toContain('realOne')
    expect(ids).not.toContain('commentedOut')
  })
})

describe('an unreadable subBlocks array', () => {
  /**
   * Every shape ships in the tree today (`SlackV2Block`, `VideoGeneratorV3Block`, the
   * `COMMON_SUBBLOCKS` spread and a backtick id), and each one used to end the run for the
   * whole repository unless the block happened to spread a base whose fields were readable.
   */
  const unreadable: [string, string][] = [
    ['a bare identifier', 'subBlocks: myFields,'],
    ['a helper call', 'subBlocks: withFalAIModelOptions(Base.subBlocks, MODELS),'],
    ['a spread of an opaque constant', 'subBlocks: [...COMMON_SUBBLOCKS],'],
    ['a backtick id', 'subBlocks: [{ id: `operation` }],'],
  ]

  it.each(unreadable)('reports %s as UNKNOWN instead of throwing', (_label, source) => {
    const supplied = extractBlockSuppliedParamIds(source, 'Widget')

    expect(supplied.ids).toBeNull()
    expect(supplied.parseError).toMatch(/Widget/)
  })

  it('still collects the mapper-written ids when only the subBlocks scan failed', () => {
    const supplied = extractBlockSuppliedParamIds(
      `
      subBlocks: myFields,
      tools: {
        config: {
          params: (params) => ({ renamed: params.original }),
        },
      },
    `,
      'Widget'
    )

    expect(supplied.ids).toBeNull()
    expect(supplied.mapperIds).toContain('renamed')
  })

  const syntheticBlock = (name: string, body: string) => `
    import type { BlockConfig } from '@/blocks/types'

    export const ${name}Block: BlockConfig = {
      type: '${name.toLowerCase()}',
      name: '${name}',
      description: 'A synthetic block',
      tools: { access: ['${name.toLowerCase()}_do'] },
      ${body}
    }
  `

  it('leaves userSettableParamIds UNKNOWN on the block config it produces', () => {
    const [unknownConfig] = extractAllBlockConfigs(syntheticBlock('Opaque', 'subBlocks: myFields,'))
    expect(unknownConfig.userSettableParamIds).toBeNull()

    const [readableConfig] = extractAllBlockConfigs(
      syntheticBlock('Readable', `subBlocks: [{ id: 'query' }],`)
    )
    expect(readableConfig.userSettableParamIds).toEqual(['query'])
  })

  it('reads action ids from tools.access when another access array appears earlier', () => {
    const [config] = extractAllBlockConfigs(`
      import type { BlockConfig } from '@/blocks/types'

      export const GovernBlock: BlockConfig = {
        type: 'govern',
        name: 'Govern',
        description: 'A synthetic block',
        canvasPresentation: {
          sentences: { byOperation: { govern_request: ['Request access'] } },
        },
        subBlocks: [{ id: 'operation' }],
        tools: { access: ['govern_request', 'govern_review'] },
      }
    `)

    expect(config.tools?.access).toEqual(['govern_request', 'govern_review'])
  })

  /**
   * The whole point of the UNKNOWN state: `[]` asserts the block supplies nothing and strips
   * every hidden param, so the two must not be spelled the same way.
   */
  it('disables the hidden-param filter, where an empty list applies it', async () => {
    const unfiltered = await getToolInfo('jira_retrieve', null)
    expect(unfiltered?.params.map((param) => param.name)).toContain('cloudId')

    const filtered = await getToolInfo('jira_retrieve', [])
    expect(filtered?.params.map((param) => param.name)).not.toContain('cloudId')
  })

  it('defaults to not filtering when no param ids are passed at all', async () => {
    const info = await getToolInfo('jira_retrieve')
    expect(info?.params.map((param) => param.name)).toContain('cloudId')
  })
})

describe('mapper param shapes', () => {
  const mapperBlock = (body: string) => `
    subBlocks: [{ id: 'doc' }],
    tools: {
      config: {
        params: (params) => ${body},
      },
    },
  `

  it('reads a shorthand property', () => {
    const { ids } = extractBlockSuppliedParamIds(
      mapperBlock('{\n  const file = params.doc\n  return { file }\n}')
    )
    expect(ids).toContain('doc')
    expect(ids).toContain('file')
  })

  it('reads a shorthand property alongside a spread and a named key', () => {
    const { ids } = extractBlockSuppliedParamIds(mapperBlock('({ ...rest, file, other: 1 })'))
    expect(ids).toEqual(expect.arrayContaining(['file', 'other']))
    expect(ids).not.toContain('rest')
  })

  it('reads a shorthand property listed after another shorthand', () => {
    const { ids } = extractBlockSuppliedParamIds(mapperBlock('({ first, file })'))
    expect(ids).toEqual(expect.arrayContaining(['first', 'file']))
  })

  it('reads a computed string assignment', () => {
    const { ids } = extractBlockSuppliedParamIds(
      mapperBlock(
        "{\n  const result: Record<string, unknown> = {}\n  result['file'] = params.doc\n  return result\n}"
      )
    )
    expect(ids).toContain('file')
  })

  it('does not take a call argument list for a shorthand property', () => {
    const { ids } = extractBlockSuppliedParamIds(
      mapperBlock('({ file: buildFile(alpha, beta, gamma) })')
    )
    expect(ids).toContain('file')
    expect(ids).not.toContain('beta')
  })

  it('ignores a shorthand property inside a comment or a string', () => {
    const { ids } = extractBlockSuppliedParamIds(
      mapperBlock("({\n  // { ghostComment }\n  note: '{ ghostString }',\n  file,\n})")
    )
    expect(ids).toContain('file')
    expect(ids).not.toContain('ghostComment')
    expect(ids).not.toContain('ghostString')
  })
})

describe('a source the scanner cannot get through is reported, not swallowed', () => {
  /**
   * When `blankStringsAndComments` bails, both the `subBlocks` scan and the mapper scan come
   * back empty for the same reason. Reported as a plain `ids: null` that is indistinguishable
   * from a spread-only `subBlocks` array, the block's mapper renames are dropped in silence.
   */
  const unterminated = `subBlocks: [{ id: 'a' }],
    tools: { config: { params: (p) => ({ renamedByMapper: p.a }) } },
    longDescription: 'never closed`

  it('sets parseError so the caller warns', () => {
    const supplied = extractBlockSuppliedParamIds(unterminated, 'GhostBlock')

    expect(supplied.parseError).not.toBeNull()
    expect(supplied.parseError).toMatch(/GhostBlock: source ends inside an unterminated/)
    expect(supplied.ids).toBeNull()
  })

  it('still reports null with no parseError for a spread-only subBlocks array', () => {
    const supplied = extractBlockSuppliedParamIds(
      'subBlocks: [...NotionBlock.subBlocks], tools: { config: { params: (p) => ({ renamedByMapper: p.a }) } },',
      'SpreadBlock'
    )

    expect(supplied.parseError).toBeNull()
    expect(supplied.ids).toBeNull()
    expect(supplied.mapperIds).toContain('renamedByMapper')
  })
})

describe('the generated catalog ordering is locale-independent', () => {
  /**
   * `localeCompare` with no locale argument uses the runtime default, which varies with `LANG`
   * and the ICU build. Against the real catalog names, `tr-TR` (dotted/dotless I), `lt-LT`,
   * `cs-CZ` (the `ch` digraph) and `et-EE` each reorder the array, so a contributor on one of
   * those locales would regenerate a different `integrations.json` and fail CI with no obvious
   * cause. Every `localeCompare` in the generator must therefore name its locale as a literal;
   * a bare `localeCompare()`, `localeCompare(b)` or a locale read from a variable all fall
   * back to the default, so the arguments are matched whole rather than pattern-matched.
   *
   * A source grep is the only assertion that can catch an unpinned comparator. CI runs under
   * an `en-US` default, where an unpinned `localeCompare` returns exactly what the pinned one
   * does, so no behavioural comparison against real catalog names discriminates there; and
   * comparing the committed `integrations.json` against the comparator that produced it agrees
   * by construction whatever the comparator does. Both of those were asserted here and were
   * removed for claiming a guarantee they did not hold.
   */
  it('leaves no unpinned localeCompare in the generator', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generate-docs.ts'), 'utf-8')

    const calls = [...source.matchAll(/\blocaleCompare\(([^)]*)\)/g)].map(([, args]) => args)

    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(args).toMatch(/,\s*'[a-zA-Z-]+'\s*$/)
  })
})

describe('the scanner survives regex literals in a block config', () => {
  /**
   * `blankStringsAndComments` used to be a single regex with no concept of a regex literal, so
   * `/don't/` opened a phantom string that swallowed the following subBlocks, and a character
   * class like `/[}]/` closed the enclosing object early. Both returned a short list with no
   * warning — a confident wrong answer, which is the one outcome the filter must never produce.
   */
  it('does not let an apostrophe inside a regex swallow later subBlocks', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', condition: (v) => /don't/.test(v) }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })

  it('does not let a brace inside a character class close the object early', () => {
    const ids = extractUserSettableParamIds("subBlocks: [{ id: 'a', v: /[}]/ }, { id: 'b' }],")

    expect(ids).toEqual(['a', 'b'])
  })

  it('still reads a division as arithmetic rather than a regex', () => {
    const ids = extractUserSettableParamIds('subBlocks: [{ id: "a", n: total / 2 }, { id: "b" }],')

    expect(ids).toEqual(['a', 'b'])
  })

  it('does not mistake a protocol slash inside a string for a comment', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', url: 'https://example.com/x' }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })

  it('reports UNKNOWN rather than guessing when a literal never terminates', () => {
    expect(extractUserSettableParamIds("subBlocks: [{ id: 'a }],")).toBeNull()
  })

  /**
   * A `/` directly after a division operator is an operand position, so it opens a regex.
   * Without `'/'` in `REGEX_ALLOWED_AFTER` the third slash of `x / y / /re/` lexes as a
   * second division, the character class is left in the structural view and its `}` closes
   * the object early — a short list with no warning.
   */
  it('reads a regex that follows a division operator', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', v: x / y / /[}]/.source }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })

  /**
   * `'+'` and `'-'` are in `REGEX_ALLOWED_AFTER` for the binary operators, so the previous
   * significant character alone reads the `/` after a postfix `i++` as opening a regex. The
   * phantom regex then runs to the end of the input and the scan reports the block unreadable.
   */
  it('still reads a division after a postfix increment or decrement', () => {
    for (const op of ['++', '--']) {
      const ids = extractUserSettableParamIds(
        `subBlocks: [{ id: 'a', n: (i) => i${op} / 2 }, { id: 'b' }],`
      )

      expect(ids, op).toEqual(['a', 'b'])
    }
  })

  /**
   * The shape Prettier produces when a `.match()` argument does not fit on one line, as in
   * `blocks/table.ts` and `blocks/table_v2.ts`. A newline is recorded as the previous
   * significant character rather than skipped, so the `(` does not carry the decision — only
   * the `'\n'` entry in `REGEX_ALLOWED_AFTER` keeps this lexing as a regex.
   */
  it('reads a regex that a formatter has wrapped onto its own line', () => {
    const ids = extractUserSettableParamIds(
      ["subBlocks: [{ id: 'a', v: (s) => s.match(", '  /[}]/', ") }, { id: 'b' }],"].join('\n')
    )

    expect(ids).toEqual(['a', 'b'])
  })
})

describe('the scanner reads a regex that opens in keyword position', () => {
  /**
   * The scanner chose regex-vs-division from the previous significant character alone, so a
   * regex in operand position was lexed as a division off the keyword's last letter and its
   * body was left in the structural view — a brace inside it then closed the object early.
   */
  it('does not let a brace inside a regex after return close the object early', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', condition: (v) => { return /}/.test(v) } }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })

  it('treats every operand-position keyword as opening a regex', () => {
    const keywords = [
      'return',
      'typeof',
      'case',
      'in',
      'of',
      'new',
      'delete',
      'void',
      'instanceof',
      'do',
      'else',
      'yield',
      'await',
    ]

    for (const keyword of keywords) {
      const ids = extractUserSettableParamIds(
        `subBlocks: [{ id: 'a', v: (x) => ${keyword} /}/.source }, { id: 'b' }],`
      )

      expect(ids, keyword).toEqual(['a', 'b'])
    }
  })

  /**
   * The fixture leaves an odd number of `/` on the line, so a mis-lexed regex runs on to the
   * end of the input rather than closing on a second slash. A self-cancelling pair like
   * `counts.in / 2, m: preturn / 2` passes with the guard removed, because the phantom regex
   * spans only `2, m: preturn ` and blanks nothing structural.
   */
  it('still reads a division after a property or an identifier that merely ends in a keyword', () => {
    expect(
      extractUserSettableParamIds("subBlocks: [{ id: 'a', n: counts.in / 2 }, { id: 'b' }],")
    ).toEqual(['a', 'b'])
    expect(
      extractUserSettableParamIds("subBlocks: [{ id: 'a', n: preturn / 2 }, { id: 'b' }],")
    ).toEqual(['a', 'b'])
  })
})

describe('template interpolation is lexed rather than brace-counted', () => {
  /**
   * The `${}` depth counter was not string-aware, so a brace inside a quoted expression
   * miscounted, the closing backtick was never found and the whole block was reported
   * unreadable — which silently stops filtering resolver-derived hidden params for it.
   */
  it('does not lose the closing backtick to an opening brace inside a quoted expression', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', label: `${format('{')}` }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })

  it('does not let a closing brace inside a quoted expression end the interpolation', () => {
    const ids = extractUserSettableParamIds(
      'subBlocks: [{ id: \'a\', label: `${format("}") + "{"}` }, { id: \'b\' }],'
    )

    expect(ids).toEqual(['a', 'b'])
  })

  it('lexes a regex, a comment and a nested template inside the expression', () => {
    const ids = extractUserSettableParamIds(
      "subBlocks: [{ id: 'a', label: `${/[{]/.source /* { */ + `${'{'}`}` }, { id: 'b' }],"
    )

    expect(ids).toEqual(['a', 'b'])
  })
})

describe('generated reference Markdown', () => {
  it('renders example URLs without adding punctuation or escape characters to their destinations', () => {
    const description = escapeMdxCell(
      'Use a URL (e.g., https://example.com/file) or [https://example.com/other].'
    )
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(`| Description |\n| --- |\n| ${description} |`)
    const table = tree.children[0]
    if (table.type !== 'table') throw new Error('Expected a reference table')
    const links = table.children[1].children[0].children.filter((node) => node.type === 'link')
    expect(links.map((link) => link.url)).toEqual([
      'https://example.com/file',
      'https://example.com/other',
    ])
  })

  it('retains one table cell for descriptions containing pipes and MDX expressions', () => {
    const description = escapeMdxCell('Use {value} with <file> and a | b.')
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(`| Description |\n| --- |\n| ${description} |`)
    const table = tree.children[0]
    if (table.type !== 'table') throw new Error('Expected a reference table')
    expect(table.children[1].children).toHaveLength(1)
    expect(table.children[1].children[0].children).toMatchObject([
      { type: 'text', value: 'Use {value} with <file> and a | b.' },
    ])
  })
  it('keeps Markdown link examples literal while preserving their automatic URL links', () => {
    const input = 'Use [label](https://example.com/file) and ![image](https://example.com/image).'
    const description = escapeMdxCell(input)
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(`| Description |\n| --- |\n| ${description} |`)
    const table = tree.children[0]
    if (table.type !== 'table') throw new Error('Expected a reference table')
    const children = table.children[1].children[0].children
    expect(children).toMatchObject([
      { type: 'text', value: 'Use [label](' },
      {
        type: 'link',
        url: 'https://example.com/file',
        children: [{ type: 'text', value: 'https://example.com/file' }],
      },
      { type: 'text', value: ') and ![image](' },
      {
        type: 'link',
        url: 'https://example.com/image',
        children: [{ type: 'text', value: 'https://example.com/image' }],
      },
      { type: 'text', value: ').' },
    ])
  })

  it('preserves balanced parentheses in HTTP and www destinations', () => {
    const description = escapeMdxCell('Use (https://example.com/a(b)) or www.example.com/a(b).')
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(`| Description |\n| --- |\n| ${description} |`)
    const table = tree.children[0]
    if (table.type !== 'table') throw new Error('Expected a reference table')
    const links = table.children[1].children[0].children.filter((node) => node.type === 'link')
    expect(links.map((link) => link.url)).toEqual([
      'https://example.com/a(b)',
      'http://www.example.com/a(b)',
    ])
  })

  it('retains existing escaping outside automatic URLs', () => {
    expect(escapeMdxCell('Keep [field], field[0], and fn(arg).')).toBe(
      'Keep \\[field\\], field\\[0\\], and fn\\(arg\\).'
    )
    expect(escapeMdxCell('Keep [field] and fn(arg) beside (https://example.com/file).')).toBe(
      'Keep \\[field\\] and fn\\(arg\\) beside \\(https://example.com/file).'
    )
  })
})
