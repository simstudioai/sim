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
  isFactoryToolDeclaration,
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
  it('preserves versioned inherited tools when the access array appends another operation', () => {
    const [block] = extractAllBlockConfigs(`
      export const ExampleBlock: BlockConfig = {
        type: 'example', name: 'Example', category: 'tools', hideFromToolbar: true,
        tools: { access: ['example_read', 'example_list'] },
      }
      export const ExampleV2Block: BlockConfig = {
        ...ExampleBlock, type: 'example_v2', hideFromToolbar: false,
        tools: { access: [
          ...(ExampleBlock.tools?.access || []).map((toolId) => \`\${toolId}_v2\`),
          'example_comments',
        ] },
      }
    `)
    expect(block.tools?.access).toEqual(['example_read_v2', 'example_list_v2', 'example_comments'])
  })

  it('preserves a satisfies block and replaces only the versioned download operation', () => {
    const [block] = extractAllBlockConfigs(`
      export const DownloadBlock = ({
        type: 'download', name: 'Download (Legacy)', description: 'Download stored files',
        category: 'tools', integrationType: IntegrationType.Documents, bgColor: '#123456',
        hideFromToolbar: true,
        subBlocks: [
          { id: 'operation', type: 'dropdown', options: [
            { id: 'download', label: 'Download' }, { id: 'list', label: 'List' },
          ] },
          { id: 'fileId', type: 'short-input' },
        ],
        tools: { access: ['download_file', 'download_list'] },
        outputs: { file: { type: 'file' }, content: { type: 'string' } },
      } as const) satisfies BlockConfig<Response>
      export const DownloadV2Block: BlockConfig = {
        ...DownloadBlock,
        type: 'download_v2', name: 'Download', hideFromToolbar: false,
        tools: { access: DownloadBlock.tools.access.map((toolId) =>
          toolId === 'download_file' ? 'download_file_v2' : toolId
        ) },
        outputs: omit(DownloadBlock.outputs, ['content']),
      }
    `)
    expect(block).toMatchObject({
      type: 'download_v2',
      description: 'Download stored files',
      category: 'tools',
      bgColor: '#123456',
      tools: { access: ['download_file_v2', 'download_list'] },
    })
    expect(block.operations).toHaveLength(2)
    expect(block.userSettableParamIds).toContain('fileId')
    expect(block.outputs).toHaveProperty('file')
    expect(block.outputs).not.toHaveProperty('content')
  })

  it('inherits tool descriptions and params but omits removed outputs from a versioned tool', () => {
    const source = `
      export const downloadTool = ({
        id: 'example_download', description: 'Download a file',
        params: { fileId: { type: 'string', required: true, description: 'File ID', } },
        outputs: { file: { type: 'file', description: 'Stored file' }, content: { type: 'string' } },
      }) satisfies ToolConfig<Params, Response>
      export const downloadV2Tool: ToolConfig<Params, V2Response> = {
        ...downloadTool, id: 'example_download_v2',
        outputs: omit(downloadTool.outputs, ['content']),
      }
    `
    const legacy = extractToolInfo('example_download', source)
    const current = extractToolInfo('example_download_v2', source)
    expect(legacy?.outputs).toHaveProperty('content')
    expect(current?.description).toBe('Download a file')
    expect(current?.params).toEqual([
      { name: 'fileId', type: 'string', required: true, description: 'File ID' },
    ])
    expect(current?.outputs).toHaveProperty('file')
    expect(current?.outputs).not.toHaveProperty('content')
  })

  it('detects factories per declaration in files mixing plain and factory tools', () => {
    const source = `
      export const plainTool = { id: 'test_plain', outputs: { file: { type: 'file' } } }
      export const factoryTool = createTool({ id: 'test_factory', outputs: {} })
    `
    expect(isFactoryToolDeclaration('test_plain', source)).toBe(false)
    expect(isFactoryToolDeclaration('test_factory', source)).toBe(true)
    const fileTools = fs.readFileSync(path.resolve('apps/sim/tools/file/get.ts'), 'utf8')
    expect(isFactoryToolDeclaration('file_get', fileTools)).toBe(false)
    expect(isFactoryToolDeclaration('file_get_content', fileTools)).toBe(false)
  })

  it('uses evaluated outputs for factory-defined tools', async () => {
    const approve = await getToolInfo('sailpoint_approve_access_request')
    const identity = await getToolInfo('sailpoint_get_identity')

    expect(Object.keys(approve?.outputs ?? {})).toEqual(['accepted', 'status'])
    expect(Object.keys(identity?.outputs ?? {})).toEqual(['identity'])
    expect(identity?.outputs.identity.properties).toHaveProperty('name')
  }, 15_000)
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
})

describe('hidden tool params in the Input table', () => {
  const blockSource = (blockFile: string) =>
    fs.readFileSync(path.join(import.meta.dirname, '../apps/sim/blocks/blocks', blockFile), 'utf-8')

  const paramNames = async (toolId: string, blockFile: string) => {
    const info = await getToolInfo(toolId, extractUserSettableParamIds(blockSource(blockFile)))
    return info?.params.map((param) => param.name) ?? []
  }

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

  it('throws when the subBlocks array holds literal objects but yields no ids', () => {
    expect(() =>
      extractUserSettableParamIds(`subBlocks: [\n  { title: 'No id here' },\n],`)
    ).toThrow(/subBlocks/)
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

  const _syntheticBlock = (name: string, body: string) => `
    import type { BlockConfig } from '@/blocks/types'

    export const ${name}Block: BlockConfig = {
      type: '${name.toLowerCase()}',
      name: '${name}',
      description: 'A synthetic block',
      tools: { access: ['${name.toLowerCase()}_do'] },
      ${body}
    }
  `

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

  it('reports UNKNOWN rather than guessing when a literal never terminates', () => {
    expect(extractUserSettableParamIds("subBlocks: [{ id: 'a }],")).toBeNull()
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
})
