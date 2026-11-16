import { describe, expect, it } from 'vitest'
import type { CanonicalWorkflow } from '../model'
import { printWorkflow } from '../print'
import { quoteString } from '../print/strings'
import type { CompileResult } from './index'
import { compileWorkflow } from './index'
import { TEST_CATALOG } from './test-catalog'

const IMPORTS =
  "import { agent, api, childWorkflow, customTool, credential, mail, mcp, stored, t, table, trigger, workflow } from '@sim/workflow-sdk'"

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
    const viaAlias = compiled(source("  mail('M', { credential: credential('ops') })"))
    const viaName = compiled(source("  mail('M', { oauthCredential: credential('ops') })"))
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
      source("  mail('M', { credential: credential('a'), oauthCredential: credential('b') })")
    )
    expect(codes(result)).toContain('E_UNSUPPORTED_SYNTAX')
  })

  it('points a pair member written by its own id at the alias', () => {
    const result = run(source("  mail('M', { manualCredential: 'x' })"))
    const unknown = result.diagnostics.find((d) => d.code === 'E_UNKNOWN_PARAM')
    expect(unknown?.hint).toMatch(/^Write it as credential;/)
  })
})

describe('stored()', () => {
  const storedText = source("  mail('M', { apiKey: 'sk-live-1', to: 'a@b.c' })")
  const storedWorkflow = compiled(storedText)

  it('prints a literal secret as stored() and an env reference as itself', () => {
    expect(printed(storedWorkflow)).toContain('apiKey: stored()')
    expect(printed(storedWorkflow)).not.toContain('sk-live-1')
    const env = compiled(source("  mail('M', { apiKey: '{{MAIL_KEY}}' })"))
    expect(printed(env)).toContain('apiKey: env.MAIL_KEY')
  })

  it('keeps the value the stored block holds', () => {
    const next = compiled(source("  mail('M', { apiKey: stored(), to: 'x@y.z' })"), storedWorkflow)
    expect(next.blocks.m?.params.apiKey).toEqual({ kind: 'value', value: 'sk-live-1' })
  })

  it.each([
    ['a block the stored workflow lacks', "  mail('Other', { apiKey: stored() })"],
    ['a field the stored block holds no value for', "  mail('M', { credential: stored() })"],
  ])('refuses %s', (_label, body) => {
    expect(codes(run(source(body), storedWorkflow))).toContain('E_STORED_VALUE_MISSING')
  })

  it('refuses stored() for a new workflow', () => {
    expect(codes(run(source("  mail('M', { apiKey: stored() })")))).toContain(
      'E_STORED_VALUE_MISSING'
    )
  })

  it('refuses stored() inside a value', () => {
    expect(codes(run(source("  mail('M', { to: [stored()] })"), storedWorkflow))).toContain(
      'E_UNSUPPORTED_SYNTAX'
    )
  })
})

describe('tool params', () => {
  const tools = (params: string) =>
    source(`  agent('A', { model: 'm', tools: [mail.tool(${params})] })`)

  it('take the alias, print it, and keep a secret behind stored()', () => {
    const storedWorkflow = compiled(
      tools("{ oauthCredential: credential('ops'), apiKey: 'sk-tool-1' }")
    )
    const text = printed(storedWorkflow)
    expect(text).toContain("mail.tool({ credential: credential('ops'), apiKey: stored() })")
    expect(text).not.toContain('sk-tool-1')
    const next = compiled(
      tools("{ credential: credential('ops'), apiKey: stored() }"),
      storedWorkflow
    )
    expect(next.blocks.a?.params.tools).toEqual(storedWorkflow.blocks.a?.params.tools)
  })

  it('refuse stored() where the stored tool holds no value', () => {
    expect(codes(run(tools('{ apiKey: stored() }')))).toContain('E_STORED_VALUE_MISSING')
  })

  describe('stored() follows the tool, not its position', () => {
    const list = (...entries: string[]) =>
      source(
        `  agent('A', { model: 'm', tools: [${entries.map((e) => `mail.tool(${e})`).join(', ')}] })`
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
    expect(quoteString('Pay‮out​')).toBe("'Pay\\u202Eout\\u200B'")
  })

  it.each([
    ['a cased block name', "'<A.data>'", true],
    ['a name that is no block', "'<nobody.data>'", true],
    ['the normalized key of a block', "'<a.data>'", false],
  ])('warns W_REF_NOT_NORMALIZED for %s: %s', (_label, literal, warns) => {
    const result = run(
      source(`  const a = api('A', { url: 'x' })\n  api('B', { url: ${literal} })`)
    )
    expect(codes(result).includes('W_REF_NOT_NORMALIZED')).toBe(warns)
    if (literal === "'<A.data>'") {
      const warning = result.diagnostics.find((d) => d.code === 'W_REF_NOT_NORMALIZED')
      expect(warning?.hint).toContain('${a.data}')
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

  it('keeps text a literal cannot reproduce as text', () => {
    const workflow = compiled(source(body))
    const row = workflow.blocks.row
    if (!row) throw new Error('missing row')
    row.params.data = { kind: 'value', value: '{\n  "subject": <start.subject>\n}' }
    expect(printed(workflow)).toContain('data: t`{')
  })
})
