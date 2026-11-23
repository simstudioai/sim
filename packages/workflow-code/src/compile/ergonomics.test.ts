import { describe, expect, it } from 'vitest'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from '../print'
import { quoteString } from '../print/strings'
import { TEST_CATALOG } from './catalog.test-helpers'
import type { CompileResult } from './index'
import { compileWorkflow } from './index'

/** Joins a fake token from parts, so no token-shaped literal sits in the source. */
const fake = (...parts: string[]) => parts.join('')

const IMPORTS =
  "import { agent, api, block, childWorkflow, condition, customTool, credential, fn, human, js, mail, mcp, parallel, raw, slack, stored, t, table, trigger, workflow } from '@sim/workflow-sdk'"

function source(body: string, header = '// @sim-sdk 1'): string {
  return `${header}\n${IMPORTS}\n\nexport default workflow('Test', {}, () => {\n${body}\n})\n`
}

function run(text: string, stored?: CanonicalWorkflow): CompileResult {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map(),
    catalog: TEST_CATALOG,
    sdkMajor: 1,
    ...(stored && { stored }),
  })
}

function compiled(text: string, stored?: CanonicalWorkflow): CanonicalWorkflow {
  const result = run(text, stored)
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  if (!result.workflow) throw new Error('expected a workflow')
  return result.workflow
}

function codes(result: CompileResult): string[] {
  return result.diagnostics.map((d) => d.code)
}

function printed(workflow: CanonicalWorkflow): string {
  return printWorkflow({ workflow, catalog: TEST_CATALOG, options: { functionCode: 'inline' } })
    .files[0].text
}

describe('param aliases', () => {
  it('compiles the alias and the param name to the same stored member, and prints the alias', () => {
    const viaAlias = compiled(source("  mail.send('M', { credential: credential('ops') })"))
    const viaName = compiled(source("  mail.send('M', { oauthCredential: credential('ops') })"))
    expect(viaAlias.blocks.m).toEqual(viaName.blocks.m)
    expect(viaAlias.blocks.m?.params.credential).toEqual({
      kind: 'value',
      value: { $sim: 'resource', kind: 'credential', key: 'ops' },
    })
    const text = printed(viaName)
    expect(text).toContain("credential: credential('ops')")
    expect(text).not.toContain('oauthCredential')
  })

  it('refuses a param written under both spellings', () => {
    const result = run(
      source("  mail.send('M', { credential: credential('a'), oauthCredential: credential('b') })")
    )
    expect(codes(result)).toContain('E_UNSUPPORTED_SYNTAX')
  })

  it('points a pair member written by its own id at the alias', () => {
    const result = run(source("  mail.send('M', { manualCredential: 'x' })"))
    const unknown = result.diagnostics.find((d) => d.code === 'E_UNKNOWN_PARAM')
    expect(unknown?.hint).toMatch(/^Write it as credential;/)
  })

  it('points block meta written among the params at the third argument', () => {
    const result = run(
      source("  mail.send('M', { to: 'a@b.c', retry: { enabled: true, maxTries: 3 } })")
    )
    const unknown = result.diagnostics.find((d) => d.code === 'E_UNKNOWN_PARAM')
    expect(unknown?.hint).toMatch(
      /^retry is block meta, not a param: pass it in the builder's third argument/
    )
  })

  it('points block meta written among the params of block() at its fourth argument', () => {
    const result = run(
      source("  block('mail', 'M', { to: 'a@b.c', retry: { enabled: true, maxTries: 3 } })")
    )
    const unknown = result.diagnostics.find((d) => d.code === 'E_UNKNOWN_PARAM')
    expect(unknown?.hint).toBe(
      "retry is block meta, not a param: pass it in block()'s fourth argument, block('type', 'Name', {…}, { retry: … })."
    )
  })
})

describe('stored()', () => {
  const storedText = source("  mail.send('M', { apiKey: 'sk-live-1', to: 'a@b.c' })")
  const storedWorkflow = compiled(storedText)

  it('prints a literal secret as stored() and an env reference as itself', () => {
    expect(printed(storedWorkflow)).toContain('apiKey: stored()')
    expect(printed(storedWorkflow)).not.toContain('sk-live-1')
    const env = compiled(source("  mail.send('M', { apiKey: '{{MAIL_KEY}}' })"))
    expect(printed(env)).toContain('apiKey: env.MAIL_KEY')
  })

  it('keeps the value the stored block holds', () => {
    const next = compiled(
      source("  mail.send('M', { apiKey: stored(), to: 'x@y.z' })"),
      storedWorkflow
    )
    expect(next.blocks.m?.params.apiKey).toEqual({ kind: 'value', value: 'sk-live-1' })
  })

  it.each([
    ['a block the stored workflow lacks', "  mail.send('Other', { apiKey: stored() })"],
    ['a field the stored block holds no value for', "  mail.send('M', { credential: stored() })"],
  ])('refuses %s', (_label, body) => {
    expect(codes(run(source(body), storedWorkflow))).toContain('E_STORED_VALUE_MISSING')
  })

  it('refuses stored() for a new workflow', () => {
    expect(codes(run(source("  mail.send('M', { apiKey: stored() })")))).toContain(
      'E_STORED_VALUE_MISSING'
    )
  })

  it('warns W_LITERAL_SECRET where a password field holds literal text, in compile and print', () => {
    const secrets = (diagnostics: ReadonlyArray<{ code: string; param?: string }>) =>
      diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET').map((d) => d.param)
    const written = run(storedText)
    expect(secrets(written.diagnostics)).toEqual(['apiKey'])
    expect(written.diagnostics.find((d) => d.code === 'W_LITERAL_SECRET')?.message).toBe(
      'apiKey holds a literal secret instead of an env reference; write apiKey: env.NAME.'
    )
    expect(
      secrets(run(source("  mail.send('M', { apiKey: stored() })"), storedWorkflow).diagnostics)
    ).toEqual(['apiKey'])
    const print = printWorkflow({
      workflow: storedWorkflow,
      catalog: TEST_CATALOG,
      options: { functionCode: 'inline' },
    })
    expect(secrets(print.diagnostics)).toEqual(['apiKey'])

    const env = run(source("  mail.send('M', { apiKey: '{{MAIL_KEY}}' })"))
    expect(secrets(env.diagnostics)).toEqual([])
    const envPrint = printWorkflow({
      workflow: compiled(source("  mail.send('M', { apiKey: '{{MAIL_KEY}}' })")),
      catalog: TEST_CATALOG,
      options: { functionCode: 'inline' },
    })
    expect(secrets(envPrint.diagnostics)).toEqual([])
  })

  it('refuses stored() inside a value', () => {
    expect(codes(run(source("  mail.send('M', { to: [stored()] })"), storedWorkflow))).toContain(
      'E_UNSUPPORTED_SYNTAX'
    )
  })
})

describe('credentials outside password fields', () => {
  const BEARER = `Bearer ${fake('sk-proj-', 'Abc123Def456Ghi789Jkl012')}`
  const headers = (value: string) =>
    source(
      `  api('Call', { url: 'https://api.example.com/v1', headers: [{ cells: { Key: 'Authorization', Value: ${quoteString(value)} } }, { cells: { Key: 'Accept', Value: 'application/json' } }] })`
    )
  const secretParams = (text: string) =>
    printWorkflow({
      workflow: compiled(text),
      catalog: TEST_CATALOG,
      options: { functionCode: 'inline' },
    })
      .diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET')
      .map((d) => d.param)

  it('prints a stored Authorization bearer header as stored(), and a re-apply keeps it unchanged', () => {
    const storedWorkflow = compiled(headers(BEARER))
    const text = printed(storedWorkflow)
    expect(text).toContain('headers: stored()')
    expect(text).not.toContain('sk-proj-')
    const reapplied = run(text, storedWorkflow)
    expect(reapplied.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(reapplied.workflow?.blocks.call?.params.headers).toEqual(
      storedWorkflow.blocks.call?.params.headers
    )
    expect(reapplied.workflow?.blocks).toEqual(storedWorkflow.blocks)
    expect(printed(reapplied.workflow as CanonicalWorkflow)).toBe(text)
  })

  it('warns where source writes the credential literally', () => {
    expect(
      run(headers(BEARER)).diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET')
    ).toHaveLength(1)
  })

  it.each([
    [
      'a token in the URL query',
      "  api('Call', { url: 'https://x.io/v1?api_key=a1b2c3d4e5f6g7h8' })",
    ],
    ['a password in the URL', "  api('Call', { url: 'postgres://admin:Hunter2pass@db.local/x' })"],
    [
      'a credential property in a JSON body',
      "  api('Call', { url: 'https://x.io', body: { client_secret: 's3cr3t-v4lu3-9876' } })",
    ],
    [
      'a GitHub token anywhere',
      `  api('Call', { url: 'https://x.io', headers: [{ cells: { Key: 'X-Gh', Value: '${fake('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789')}' } }] })`,
    ],
    [
      'a token in function code',
      `  fn('F', { code: js\`const key = '${fake('xoxb-', '1234567890-abcdef')}'\nreturn key\` })`,
    ],
  ])('detects %s', (_label, body) => {
    expect(secretParams(source(body)).length).toBe(1)
  })

  it.each([
    [
      'an env reference in a bearer header',
      "  api('Call', { url: 'https://x.io', headers: [{ cells: { Key: 'Authorization', Value: 'Bearer {{OPENAI_KEY}}' } }] })",
    ],
    [
      'a block reference in a bearer header',
      "  const s = trigger.start('S')\n  api('Call', { url: 'https://x.io', headers: [{ cells: { Key: 'Authorization', Value: t`Bearer ${s.input}` } }] })",
    ],
    [
      'ordinary headers and query params',
      "  api('Call', { url: 'https://x.io/v1/users?page=2&sort=created_at&token=', headers: [{ cells: { Key: 'Content-Type', Value: 'application/json' } }, { cells: { Key: 'X-Request-Id', Value: '3f2c9a7e-1b4d-4e8f-9c0a-7d6e5f4a3b2c' } }] })",
    ],
    [
      'placeholders',
      "  api('Call', { url: 'https://x.io', body: { api_key: 'YOUR_API_KEY', password: '********' } })",
    ],
    [
      'prose about tokens',
      "  agent('A', { model: 'gpt-4o', messages: [{ role: 'system', content: 'Explain how a Bearer token and an api_key=... query param differ, and what sk-learn does.' }] })",
    ],
    [
      'a pagination token name',
      "  api('Call', { url: 'https://x.io/items?pageToken=abc&nextToken=CAESBggBEAEYAQ' })",
    ],
  ])('leaves %s alone', (_label, body) => {
    expect(secretParams(source(body))).toEqual([])
  })

  it('prints an MCP tool argument holding a credential as stored() and keeps it on apply', () => {
    const body = (args: string) =>
      source(`  agent('A', { model: 'm', tools: [mcp('docs').tool('search', { args: ${args} })] })`)
    const storedWorkflow = compiled(
      body(`{ q: 'x', apiKey: '${fake('sk-ant-', 'api03-AbCdEf0123456789XyZ')}' }`)
    )
    const text = printed(storedWorkflow)
    expect(text).toContain('apiKey: stored()')
    expect(text).not.toContain('sk-ant-')
    const reapplied = compiled(text, storedWorkflow)
    expect(reapplied.blocks.a?.params.tools).toEqual(storedWorkflow.blocks.a?.params.tools)
  })
})

describe('tool params', () => {
  const tools = (params: string) =>
    source(`  agent('A', { model: 'm', tools: [mail.tool.send(${params})] })`)

  it('take the alias, print it, and keep a secret behind stored()', () => {
    const storedWorkflow = compiled(
      tools("{ oauthCredential: credential('ops'), apiKey: 'sk-tool-1' }")
    )
    const text = printed(storedWorkflow)
    expect(text).toContain("mail.tool.send({ credential: credential('ops'), apiKey: stored() })")
    expect(text).not.toContain('sk-tool-1')
    expect(
      printWorkflow({
        workflow: storedWorkflow,
        catalog: TEST_CATALOG,
        options: { functionCode: 'inline' },
      })
        .diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET')
        .map((d) => d.param)
    ).toEqual(['apiKey'])
    const next = compiled(
      tools("{ credential: credential('ops'), apiKey: stored() }"),
      storedWorkflow
    )
    expect(next.blocks.a?.params.tools).toEqual(storedWorkflow.blocks.a?.params.tools)
  })

  it('warn W_LITERAL_SECRET where source writes a secret, as print does', () => {
    const result = run(tools("{ credential: credential('ops'), apiKey: 'sk-tool-1', to: 'a@x.y' }"))
    expect(
      result.diagnostics.filter((d) => d.code === 'W_LITERAL_SECRET').map((d) => d.param)
    ).toEqual(['apiKey'])
  })

  it.each([
    ['a misspelled param', "{ credential: credential('ops'), apiKy: 'x' }", 'Did you mean apiKey?'],
    [
      "a pair member's own id",
      "{ manualCredential: 'x' }",
      'Write it as credential; the value kind picks the basic or advanced field.',
    ],
  ])('refuse %s, as a block does', (_label, params, hint) => {
    const result = run(tools(params))
    expect(result.workflow).toBeNull()
    expect(
      result.diagnostics.filter((d) => d.code === 'E_UNKNOWN_PARAM').map((d) => d.hint)
    ).toEqual([hint])
  })

  it('keep a param of another operation, warning that the tool never reads it', () => {
    const result = run(
      source("  agent('A', { model: 'm', tools: [slack.tool.listChannels({ channel: 'C1' })] })")
    )
    expect(result.workflow).not.toBeNull()
    expect(
      result.diagnostics.filter((d) => d.code === 'W_FIELD_NOT_APPLICABLE').map((d) => d.param)
    ).toEqual(['channel'])
  })

  it('refuse stored() where the stored tool holds no value', () => {
    expect(codes(run(tools('{ apiKey: stored() }')))).toContain('E_STORED_VALUE_MISSING')
  })

  describe('stored() follows the tool, not its position', () => {
    const list = (...entries: string[]) =>
      source(
        `  agent('A', { model: 'm', tools: [${entries.map((e) => `mail.tool.send(${e})`).join(', ')}] })`
      )
    const storedWorkflow = compiled(
      list("{ apiKey: 'sk-A', to: 'a@x.y' }", "{ apiKey: 'sk-B', to: 'b@x.y' }")
    )
    const keys = (workflow: CanonicalWorkflow) => {
      const param = workflow.blocks.a?.params.tools
      return param?.kind === 'tools' ? param.tools.map((tool) => tool.params.apiKey) : []
    }

    it('keeps each secret with its tool when the first tool is deleted', () => {
      const next = compiled(list("{ apiKey: stored(), to: 'b@x.y' }"), storedWorkflow)
      expect(keys(next)).toEqual(['sk-B'])
    })

    it('keeps each secret with its tool when the tools are reordered', () => {
      const next = compiled(
        list("{ apiKey: stored(), to: 'b@x.y' }", "{ apiKey: stored(), to: 'a@x.y' }"),
        storedWorkflow
      )
      expect(keys(next)).toEqual(['sk-B', 'sk-A'])
    })

    it('matches by position while the list keeps its stored shape', () => {
      const next = compiled(
        list("{ apiKey: stored(), to: 'a2@x.y' }", "{ apiKey: stored(), to: 'b2@x.y' }"),
        storedWorkflow
      )
      expect(keys(next)).toEqual(['sk-A', 'sk-B'])
    })

    it('refuses an edited tool that no longer identifies one stored tool', () => {
      expect(codes(run(list("{ apiKey: stored(), to: 'c@x.y' }"), storedWorkflow))).toContain(
        'E_STORED_VALUE_MISSING'
      )
    })

    it('keeps a stored() param in the place source wrote it, so the print is a fixed point', () => {
      const text = printed(storedWorkflow)
      expect(text).toContain("mail.tool.send({ apiKey: stored(), to: 'a@x.y' })")
      expect(printed(compiled(text, storedWorkflow))).toBe(text)
    })
  })

  it('redact a secret inside raw(tool) as stored() and keep it on compile', () => {
    // A stored key spelled like an alias (`credential`) has no builder form, so it prints raw().
    const storedWorkflow = compiled(
      source(
        "  agent('A', { model: 'm', tools: [raw({ type: 'mail', params: { credential: 'c1', apiKey: 'sk-raw-1', to: 'a@x.y' }, modes: {} })] })"
      )
    )
    const text = printed(storedWorkflow)
    expect(text).toContain('apiKey: stored()')
    expect(text).not.toContain('sk-raw-1')
    const next = compiled(text, storedWorkflow)
    expect(next.blocks.a?.params.tools).toEqual(storedWorkflow.blocks.a?.params.tools)
    expect(printed(next)).toBe(text)
  })
})

describe('condition rows stored with no title', () => {
  it('round-trip as title: null, so the last row never becomes the else branch', () => {
    const workflow = compiled(source("  condition('Gate', { if: js`x > 1`, else: true })"))
    const rows = workflow.blocks.gate?.branches?.rows
    if (!rows?.[1]) throw new Error('expected two rows')
    rows[1].titleMissing = true
    const text = printed(workflow)
    expect(text).toContain('else: { title: null }')
    expect(compiled(text).blocks.gate?.branches).toEqual(workflow.blocks.gate?.branches)
  })
})

describe('a raw edge into a container child', () => {
  it('prints where both ends are visible and compiles back to the same raw port', () => {
    const workflow = compiled(
      source(
        "  parallel.count('L', { count: 3 }, (p) => {\n    const f = fn('F', { code: js`return 1` })\n    p.to(f)\n  })"
      )
    )
    workflow.edges = workflow.edges.map((edge) =>
      edge.from === 'l' && edge.to === 'f'
        ? { ...edge, port: { kind: 'raw', handle: 'loop-start-source' } }
        : edge
    )
    expect(compiled(printed(workflow)).edges).toEqual(workflow.edges)
  })
})

describe('header, names and hand-written references', () => {
  it('refuses a header major below the oldest the server reads', () => {
    expect(codes(run(source("  api('A', { url: 'x' })", '// @sim-sdk 0')))).toEqual([
      'E_SDK_MAJOR_OLD',
    ])
  })

  it('warns on an invisible bidi or zero-width character in a block name, and prints it escaped', () => {
    const result = run(source("  api('Pay\\u202Eout', { url: 'x' })"))
    expect(codes(result)).toEqual(['W_SUSPICIOUS_CHARACTER'])
    expect(quoteString('Pay\u202Eout\u200B')).toBe("'Pay\\u202Eout\\u200B'")
  })

  it('warns on an invisible bidi or zero-width character in the workflow name', () => {
    const text = source("  api('A', { url: 'x' })").replace(
      "workflow('Test'",
      "workflow('Pay\\u202Eout'"
    )
    expect(codes(run(text))).toEqual(['W_SUSPICIOUS_CHARACTER'])
  })

  it('refuses two block names that differ only by Unicode normalization, keeping each as written', () => {
    const result = run(
      source("  api('Caf\\u00E9', { url: 'x' })\n  api('Cafe\\u0301', { url: 'y' })")
    )
    expect(codes(result)).toEqual(['E_LOOKALIKE_NAME'])
    expect(result.diagnostics[0]?.related?.[0]?.message).toContain('Caf\u00E9')
  })

  it('only warns on look-alike block names the stored workflow already has, and stores both as written', () => {
    const text = source("  api('Caf\\u00E9', { url: 'x' })\n  api('Cafe\\u0301', { url: 'y' })")
    const result = compileWorkflow({
      entry: { path: 'workflow.ts', text },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      knownKeys: new Set(['caf\u00E9', 'cafe\u0301']),
    })
    expect(codes(result)).toEqual(['W_LOOKALIKE_NAME'])
    expect(Object.keys(result.workflow?.blocks ?? {}).sort()).toEqual(
      ['caf\u00E9', 'cafe\u0301'].sort()
    )
  })

  it('refuses a block name that mixes Cyrillic and Latin letters in one word, beside its Latin twin or alone', () => {
    const twin = run(source("  api('Claude', { url: 'x' })\n  api('\\u0421laude', { url: 'y' })"))
    expect(codes(twin)).toEqual(['E_LOOKALIKE_NAME'])
    expect(twin.diagnostics[0]?.message).toContain('U+0421, Cyrillic')
    expect(codes(run(source("  api('Ch\\u0435ck', { url: 'x' })")))).toEqual(['E_LOOKALIKE_NAME'])
  })

  it('accepts names written in one script per word, and keeps a stored mixed name with a warning', () => {
    expect(
      codes(
        run(source("  api('Send to \\u041C\\u043E\\u0441\\u043A\\u0432\\u0430', { url: 'x' })"))
      )
    ).toEqual([])
    expect(codes(run(source("  api('\\u0394elta', { url: 'x' })")))).toEqual(['E_LOOKALIKE_NAME'])
    const stored = compileWorkflow({
      entry: { path: 'workflow.ts', text: source("  api('\\u0421laude', { url: 'y' })") },
      files: new Map(),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      knownKeys: new Set(['\u0421laude'.toLowerCase()]),
    })
    expect(codes(stored)).toEqual(['W_LOOKALIKE_NAME'])
  })

  it.each([
    ['an Arabic letter mark', 0x061c],
    ['a Mongolian vowel separator', 0x180e],
    ['a word joiner', 0x2060],
    ['an invisible plus', 0x2064],
    ['a deprecated shaping control', 0x206f],
    ['a zero-width no-break space', 0xfeff],
  ])('treats %s as invisible in names and printed text', (_, code) => {
    const char = String.fromCharCode(code)
    const escaped = `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
    expect(codes(run(source(`  api('Pay${escaped}out', { url: 'x' })`)))).toEqual([
      'W_SUSPICIOUS_CHARACTER',
    ])
    expect(quoteString(`Pay${char}out`)).toBe(`'Pay${escaped}out'`)
  })

  it.each([
    ['a cased block name', "'<A.data>'", 'W_REF_NOT_NORMALIZED'],
    ['a name that is no block', "'<nobody.data>'", 'W_UNRESOLVED_REF'],
    ['a bare tag that is no reference', "'<nobody>'", 'W_REF_NOT_NORMALIZED'],
    ['the normalized key of a block', "'<a.data>'", undefined],
  ])('warns for %s: %s', (_label, literal, warning) => {
    const result = run(
      source(`  const a = api('A', { url: 'x' })\n  api('B', { url: ${literal} })`)
    )
    const found = codes(result).filter(
      (code) => code === 'W_REF_NOT_NORMALIZED' || code === 'W_UNRESOLVED_REF'
    )
    expect(found).toEqual(warning ? [warning] : [])
    if (literal === "'<A.data>'") {
      const diagnostic = result.diagnostics.find((d) => d.code === 'W_REF_NOT_NORMALIZED')
      expect(diagnostic?.hint).toContain('${a.data}')
    }
  })
})

describe('customTool() in a tool list', () => {
  it('compiles to the tool picker reference and prints back the same call', () => {
    const text = source(
      "  agent('A', { model: 'm', tools: [customTool('lookup', { usageControl: 'auto' })] })"
    )
    const workflow = compiled(text)
    expect(workflow.blocks.a?.params.tools).toEqual({
      kind: 'tools',
      tools: [
        {
          type: 'custom-tool',
          params: {},
          modes: {},
          usageControl: 'auto',
          customTool: { ref: { $sim: 'resource', kind: 'custom-tool', key: 'lookup' } },
        },
      ],
    })
    expect(printed(workflow)).toContain("customTool('lookup', { usageControl: 'auto' })")
  })

  it('refuses an option the reference does not store', () => {
    const result = run(
      source("  agent('A', { model: 'm', tools: [customTool('lookup', { title: 'x' })] })")
    )
    expect(codes(result)).toContain('E_UNSUPPORTED_SYNTAX')
  })
})

describe('mcp().tool() and childWorkflow().asTool() in a tool list', () => {
  const agentWith = (tool: string) => source(`  agent('A', { model: 'm', tools: [${tool}] })`)

  it('compiles an MCP tool to the picker entry and prints back the same call', () => {
    const call =
      "mcp('docs').tool('search', { args: { limit: '5' }, usageControl: 'auto', snapshot: { serverName: 'Docs', schema: { type: 'object' } } })"
    const workflow = compiled(agentWith(call))
    expect(workflow.blocks.a?.params.tools).toEqual({
      kind: 'tools',
      tools: [
        {
          type: 'mcp',
          title: 'search',
          params: {
            serverId: { $sim: 'resource', kind: 'mcp-server', key: 'docs' },
            toolName: 'search',
            serverName: 'Docs',
            limit: '5',
          },
          modes: {},
          usageControl: 'auto',
          extra: { schema: { type: 'object' } },
        },
      ],
    })
    expect(printed(workflow).replace(/\s+/g, ' ')).toContain(
      "mcp('docs').tool('search', { args: { limit: '5' }, usageControl: 'auto', snapshot: { serverName: 'Docs', schema: { type: 'object' } }, })"
    )
  })

  it('compiles a child workflow tool to the picker entry and prints back the same call', () => {
    const workflow = compiled(agentWith("childWorkflow('enrich').asTool({ usageControl: 'none' })"))
    expect(workflow.blocks.a?.params.tools).toEqual({
      kind: 'tools',
      tools: [
        {
          type: 'workflow_input',
          title: 'Workflow',
          toolId: 'workflow_executor',
          params: { workflowId: { $sim: 'resource', kind: 'workflow', key: 'enrich' } },
          modes: {},
          usageControl: 'none',
        },
      ],
    })
    expect(printed(workflow)).toContain("childWorkflow('enrich').asTool({ usageControl: 'none' })")
  })

  it.each([
    ["mcp('docs').tool('search', { args: { serverId: 'x' } })", 'an argument the binding writes'],
    ["mcp('docs').tool('search', { title: 'x' })", 'an option the entry does not store'],
    [
      "mcp('docs').tool('search', { snapshot: { other: 1 } })",
      'a snapshot field the picker never saves',
    ],
    ["childWorkflow('enrich').asTool({ title: 'x' })", 'an asTool option the entry does not store'],
  ])('refuses %s (%s)', (call) => {
    expect(codes(run(agentWith(call)))).toContain('E_UNSUPPORTED_SYNTAX')
  })
})

describe('JSON field literals', () => {
  const body = [
    "  const start = trigger.start('Start', { inputFormat: { subject: 'string' } })",
    "  const a = api('A', { url: 'x' })",
    "  table.insertRow('Row', { data: { subject: start.subject, data: a.data, status: a.status, note: t`re: ${start.subject}` } })",
  ].join('\n')

  it('stores a string reference quoted, any other typed reference bare, and prints the literal back', () => {
    const workflow = compiled(source(body))
    expect(workflow.blocks.row?.params.data).toEqual({
      kind: 'value',
      value:
        '{\n  "subject": "<start.subject>",\n  "data": <a.data>,\n  "status": <a.status>,\n  "note": "re: <start.subject>"\n}',
    })
    expect(printed(workflow)).toContain(
      'data: { subject: start.subject, data: a.data, status: a.status, note: t`re: ${start.subject}` }'
    )
  })

  it('warns on a reference nothing types, which is stored bare', () => {
    const result = run(
      source(
        `${body.split('\n').slice(0, 2).join('\n')}\n  table.insertRow('Row', { data: { id: a.data.id } })`
      )
    )
    expect(codes(result)).toEqual(['W_JSON_REF_UNTYPED'])
  })

  it('refuses an inputFormat entry whose name differs from its key, which names the field', () => {
    const result = run(
      source(
        "  const start = trigger.start('Start', { inputFormat: { subject: { name: 'other', type: 'string' } } })"
      )
    )
    expect(codes(result)).toEqual(['E_UNSUPPORTED_SYNTAX'])
  })

  it.each(['5', 'true', 'null', "['string']", '{ value: 5 }', '{ type: 5 }'])(
    'refuses an inputFormat entry %s that names no type',
    (entry) => {
      const result = run(
        source(`  const start = trigger.start('Start', { inputFormat: { count: ${entry} } })`)
      )
      expect(codes(result)).toEqual(['E_UNSUPPORTED_SYNTAX'])
    }
  )

  it("types a human form's fields under submission, as the SDK does", () => {
    const workflow = compiled(
      source(
        [
          "  const h = human('Approve', { inputFormat: { ok: 'boolean', note: 'string' } })",
          "  table.insertRow('Row', { data: { ok: h.submission.ok, note: h.submission.note } })",
        ].join('\n')
      )
    )
    expect(workflow.blocks.row?.params.data).toEqual({
      kind: 'value',
      value: '{\n  "ok": <approve.submission.ok>,\n  "note": "<approve.submission.note>"\n}',
    })
  })

  it('keeps text a literal cannot reproduce as text', () => {
    const workflow = compiled(source(body))
    const row = workflow.blocks.row
    if (!row) throw new Error('missing row')
    row.params.data = { kind: 'value', value: '{\n  "subject": <start.subject>\n}' }
    expect(printed(workflow)).toContain('data: t`{')
  })
})
