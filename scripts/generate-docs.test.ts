import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  extractBlockSuppliedParamIds,
  extractUserSettableParamIds,
  getToolInfo,
  parseConstProperties,
  parsePropertiesContent,
} from './generate-docs'

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

  it('returns no ids for blocks whose subBlocks array holds only spreads', () => {
    for (const blockFile of [
      'imap.ts',
      'chat_trigger.ts',
      'generic_webhook.ts',
      'manual_trigger.ts',
      'circleback.ts',
      'rss.ts',
      'sim_workspace_event.ts',
    ]) {
      expect(extractUserSettableParamIds(blockSource(blockFile))).toEqual([])
    }
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

    it('still returns no ids for an array of nothing but named fields arrays', () => {
      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...NotionBlock.subBlocks,\n  ...getTrigger('notion_page_created').subBlocks,\n],`,
          'NotionV2'
        )
      ).toEqual([])

      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...LinearBlock.subBlocks.filter((sb) => !sb.id?.startsWith('webhookSecret')),\n],`,
          'LinearV2'
        )
      ).toEqual([])
    })

    it('does not fail a block that overrides a spread subBlock instead of naming an id', () => {
      expect(
        extractUserSettableParamIds(
          `subBlocks: [\n  ...Base.subBlocks.map((sb) => (sb.id === 'x' ? { ...sb, required: true } : sb)),\n],`,
          'OverridingV2'
        )
      ).toEqual([])
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
    const info = await getToolInfo(toolId, extractBlockSuppliedParamIds(blockSource(blockFile)))
    return info?.params.map((param) => param.name) ?? []
  }

  it("keeps Cal.com's required attendee, assembled as result.attendee in the mapper", async () => {
    expect(extractBlockSuppliedParamIds(blockSource('calcom.ts'))).toContain('attendee')
    await expect(paramNames('calcom_create_booking', 'calcom.ts')).resolves.toContain('attendee')
  })

  it("keeps JSM's workspaceId, renamed from assetWorkspaceId in the mapper", async () => {
    expect(extractBlockSuppliedParamIds(blockSource('jira_service_management.ts'))).toContain(
      'workspaceId'
    )
    await expect(
      paramNames('jsm_list_object_schemas', 'jira_service_management.ts')
    ).resolves.toContain('workspaceId')
  })

  it('keeps the file params Textract renames from its document field', async () => {
    const ids = extractBlockSuppliedParamIds(blockSource('textract.ts'))
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
    const ids = extractBlockSuppliedParamIds(`
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
    const ids = extractBlockSuppliedParamIds(`
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
    const ids = extractBlockSuppliedParamIds(`
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
