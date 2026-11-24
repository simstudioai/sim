import type { Json } from '@sim/workflow-code'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type ToolDecl, toolCodec } from './tools'

const text = fc.string({ maxLength: 30 }).filter((value) => !/[\u0000\ud800-\udfff]/.test(value))
/** A JSON key the declaration reader accepts: it refuses `__proto__` and the helper marker. */
const jsonKey = text.filter((key) => key !== '$call' && key !== '__proto__')

const json: fc.Arbitrary<Json> = fc.letrec<{ value: Json }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
    text,
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(jsonKey, tie('value'), { maxKeys: 3 })
  ),
})).value

const code = fc.oneof(
  text,
  fc.constantFrom(
    'return {{API_KEY}}',
    'const url = "{{BASE_URL}}/orders"\nreturn fetch(url)',
    'return <start.input>',
    'return $env.NAME',
    'return (',
    ''
  )
)

const tool: fc.Arbitrary<ToolDecl> = fc.record({
  title: text.filter((value) => value.length > 0),
  schema: fc.record({
    type: fc.constant('function'),
    function: fc.record({
      name: fc.stringMatching(/^[a-z_]{1,10}$/),
      parameters: fc.record({
        type: fc.constant('object'),
        properties: fc.dictionary(jsonKey, json),
      }),
      extra: json,
    }),
  }),
  code,
})

function parse(text: Record<string, string>) {
  return toolCodec.parse('lookup', text, [])
}

const DECLARATION = `// @sim-sdk 1
import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'

export default defineTool({
  title: 'Lookup',
  schema: {
    type: 'function',
    function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
  },
  code: codeFile('./lookup.js'),
})
`

describe('toolCodec', () => {
  it('reads back every tool it prints, byte-stable', () => {
    fc.assert(
      fc.property(tool, (decl) => {
        const printed = toolCodec.print('lookup', decl)
        const parsed = toolCodec.parse('lookup', printed.text, [])
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        if (parsed.decl) expect(toolCodec.print('lookup', parsed.decl)).toEqual(printed)
      }),
      { numRuns: 300 }
    )
  })

  it('keeps env references as names in the code file and stores them as tokens', () => {
    const parsed = parse({
      'tools/lookup.ts': DECLARATION,
      'tools/lookup.js': 'const key = $env.API_KEY\nreturn key\n',
    })
    expect(parsed.decl?.code).toBe('const key = {{API_KEY}}\nreturn key\n')
    const printed = toolCodec.print('lookup', { ...(parsed.decl as ToolDecl) })
    expect(printed.text['tools/lookup.js']).toBe('const key = $env.API_KEY\nreturn key\n')
  })

  it('prints code the file form cannot hold exactly as an inline string', () => {
    const printed = toolCodec.print('lookup', {
      title: 'Lookup',
      schema: {},
      code: 'return $env.A + {{B}}',
    })
    expect(Object.keys(printed.text)).toEqual(['tools/lookup.ts'])
    expect(printed.text['tools/lookup.ts']).toContain("code: 'return $env.A + {{B}}'")
  })

  it('pins a code file syntax error to its line in the .js file', () => {
    const parsed = parse({
      'tools/lookup.ts': DECLARATION,
      'tools/lookup.js': 'const a = 1\nreturn (\n',
    })
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics[0]).toMatchObject({
      code: 'E_TOOL_CODE',
      kind: 'custom-tool',
      key: 'lookup',
      span: { file: 'tools/lookup.js', line: 3 },
    })
  })

  it('refuses a missing code file, a code file under another name, and an unused one', () => {
    expect(parse({ 'tools/lookup.ts': DECLARATION }).diagnostics[0]).toMatchObject({
      code: 'E_TOOL_CODE',
      message: 'tools/lookup.js is missing.',
    })
    expect(
      parse({
        'tools/lookup.ts': DECLARATION.replace('./lookup.js', './other.js'),
        'tools/lookup.js': '',
      }).diagnostics[0]
    ).toMatchObject({ code: 'E_TOOL_CODE', span: { file: 'tools/lookup.ts', line: 10 } })
    expect(
      parse({
        'tools/lookup.ts': DECLARATION.replace("codeFile('./lookup.js')", "'return 1'"),
        'tools/lookup.js': 'return 2',
      }).diagnostics[0]
    ).toMatchObject({ code: 'E_TOOL_CODE', message: expect.stringContaining('unused') })
    expect(parse({ 'tools/lookup.js': 'return 1' }).diagnostics[0]).toMatchObject({
      code: 'E_DECL_UNKNOWN_FILE',
    })
  })

  it('refuses a workflow reference in a code file, pinned to it, and prints stored ones inline', () => {
    const parsed = parse({
      'tools/lookup.ts': DECLARATION,
      'tools/lookup.js': 'const id = 1\nreturn $ref.start.input\n',
    })
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics).toMatchObject([
      { code: 'E_TOOL_CODE', span: { file: 'tools/lookup.js', line: 2, column: 8 } },
    ])

    const printed = toolCodec.print('lookup', {
      title: 'Lookup',
      schema: {},
      code: 'return <start.input>',
    })
    expect(Object.keys(printed.text)).toEqual(['tools/lookup.ts'])
  })

  it('refuses a helper call inside the schema, and NUL in the code', () => {
    expect(
      parse({
        'tools/lookup.ts': DECLARATION.replace("type: 'function',", "type: codeFile('./x.js'),"),
        'tools/lookup.js': '',
      }).diagnostics.map((finding) => finding.code)
    ).toEqual(['E_TOOL_SCHEMA'])
    expect(
      parse({ 'tools/lookup.ts': DECLARATION, 'tools/lookup.js': 'return "\u0000"' }).diagnostics[0]
    ).toMatchObject({ code: 'E_TOOL_CODE', message: expect.stringContaining('NUL') })
  })

  it('groups a declaration with its code file and refuses anything else in tools/', () => {
    const grouped = toolCodec.group([
      'tools/lookup.ts',
      'tools/lookup.js',
      'tools/notes.md',
      'tools/nested/x.ts',
      'tools/Bad.ts',
    ])
    expect([...grouped.groups]).toEqual([['lookup', ['tools/lookup.ts', 'tools/lookup.js']]])
    expect(grouped.diagnostics.map((finding) => finding.code)).toEqual([
      'E_DECL_UNKNOWN_FILE',
      'E_DECL_UNKNOWN_FILE',
      'E_KEY_INVALID',
    ])
  })

  it('prints code the server keeps as stored(), with no code file, and reads stored() back', () => {
    const printed = toolCodec.print('lookup', {
      title: 'Lookup',
      schema: {},
      code: { stored: 'hash' },
    })
    expect(Object.keys(printed.text)).toEqual(['tools/lookup.ts'])
    expect(printed.text['tools/lookup.ts']).toContain('code: stored()')
    expect(printed.text['tools/lookup.ts']).toContain(
      "import { defineTool, stored } from '@sim/workflow-sdk/workspace'"
    )
    const parsed = parse(printed.text)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.decl?.code).toEqual({ stored: null })
  })

  it.each([
    [
      'a code file',
      (code: string) => ({ 'tools/lookup.ts': DECLARATION, 'tools/lookup.js': code }),
    ],
    [
      'an inline string',
      (code: string) => ({
        'tools/lookup.ts': DECLARATION.replace("codeFile('./lookup.js')", JSON.stringify(code)),
      }),
    ],
  ])('warns on code in %s holding a literal credential, and keeps it', (_label, files) => {
    const code = `return '${['gh', 'p_', 'a'.repeat(36)].join('')}'`
    const parsed = parse(files(code))
    expect(parsed.diagnostics.map((finding) => finding.code)).toEqual(['W_TOOL_LITERAL_SECRET'])
    expect(parsed.decl?.code).toBe(code)
  })
})
