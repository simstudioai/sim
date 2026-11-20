import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../compile'
import { diffCanonical } from '../diff'
import { materialize } from '../materialize'
import {
  blockState,
  CATALOG,
  canonical,
  fixtureHooks,
  RESOURCES,
  workflowState,
} from '../materialize/fixtures.test-helpers'
import { printWorkflow } from '../print/printer'
import { checkCodeFileBijection, codeFileLanguage, fromCodeFile, toCodeFile } from './index'

describe('toCodeFile rewrites only code-position tokens', () => {
  it.each([
    ['return <start.input>', 'return $ref.start.input'],
    ['const k = {{API_KEY}}', 'const k = $env.API_KEY'],
    ['f(<a.items[0].id>)', 'f($ref.a.items[0].id)'],
    ['f(<a.items.0>)', "f($ref.a.items['0'])"],
    ['f(<b.some-field>)', "f($ref.b['some-field'])"],
    ['f(<my-block.x>)', "f($ref['my-block'].x)"],
    ['f(<loop.currentItem>)', 'f($ref.loop.currentItem)'],
    ['`a ${<a.b>} c`', '`a ${$ref.a.b} c`'],
    ['`a ${f({ k: <a.b> })} c`', '`a ${f({ k: $ref.a.b })} c`'],
  ])('%s', (code, file) => {
    expect(toCodeFile(code, 'javascript')).toBe(file)
    expect(fromCodeFile(file, 'javascript')).toMatchObject({ ok: true, code })
  })

  it.each([
    ["'<a.b>'"],
    ['"x {{API_KEY}} y"'],
    ['`<a.b>`'],
    ['// <a.b> {{API_KEY}}\nreturn 1'],
    ['/* <a.b> */ return 1'],
    ['const r = /<a.b>/'],
    ["if (x) /'<a.b>/.test(y)"],
  ])('keeps %s verbatim', (code) => {
    expect(toCodeFile(code, 'javascript')).toBe(code)
  })

  it('leaves tokens it cannot map bijectively', () => {
    expect(toCodeFile('x = {{ API_KEY }}', 'javascript')).toBe('x = {{ API_KEY }}')
    expect(toCodeFile('x = <a.items[01]>', 'javascript')).toBe('x = <a.items[01]>')
    expect(toCodeFile("x = <a.it's>", 'javascript')).toBe("x = <a.it's>")
    expect(toCodeFile('x = <a[0]x3]>', 'javascript')).toBe('x = <a[0]x3]>')
  })

  it('never rewrites python or shell bodies', () => {
    const python = 'x = <start.input>\nprint({{API_KEY}})'
    expect(toCodeFile(python, 'python')).toBe(python)
    expect(fromCodeFile(python, 'python')).toMatchObject({ ok: true, code: python })
    const shell = 'echo <start.input> $API_KEY'
    expect(toCodeFile(shell, 'shell')).toBe(shell)
  })
})

describe('fromCodeFile', () => {
  it('ends a reference at a parenthesis', () => {
    expect(fromCodeFile('return ($ref.a.b).length', 'javascript')).toMatchObject({
      ok: true,
      code: 'return (<a.b>).length',
    })
  })

  it('maps only the env name segment', () => {
    expect(fromCodeFile('return $env.KEY.length', 'javascript')).toMatchObject({
      ok: true,
      code: 'return {{KEY}}.length',
    })
  })

  it('accepts top-level return, await and import', () => {
    const file = "import x from 'y'\nconst r = await $ref.a.b\nreturn r"
    expect(fromCodeFile(file, 'javascript')).toMatchObject({
      ok: true,
      code: "import x from 'y'\nconst r = await <a.b>\nreturn r",
    })
  })

  it('reports syntax errors with a location', () => {
    const result = fromCodeFile('const = 1', 'javascript')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatchObject({ line: 1 })
  })

  it('leaves member chains it cannot map', () => {
    expect(fromCodeFile('f($ref[k])', 'javascript')).toMatchObject({ ok: true, code: 'f($ref[k])' })
    expect(fromCodeFile('f($env[k])', 'javascript')).toMatchObject({ ok: true, code: 'f($env[k])' })
  })
})

describe('checkCodeFileBijection', () => {
  it('accepts code whose file form reverses exactly', () => {
    expect(checkCodeFileBijection('return <a.b> + 1', 'javascript')).toEqual({
      ok: true,
      file: 'return $ref.a.b + 1',
    })
  })

  it.each([
    ['code that already names $ref', 'return $ref.a + <b.c>'],
    ['a reference followed by a member access', 'return <a.b>.length'],
    ['a reference followed by an index', 'return <a.b>[0]'],
    ['code that is not valid JavaScript', 'return <a.b'],
  ])('rejects %s', (_label, code) => {
    expect(checkCodeFileBijection(code, 'javascript').ok).toBe(false)
  })

  it('accepts any python or shell body', () => {
    expect(checkCodeFileBijection('print(<a.b>.x)', 'python')).toEqual({
      ok: true,
      file: 'print(<a.b>.x)',
    })
  })
})

describe('codeFileLanguage', () => {
  it.each([
    ['fns/a.js', 'javascript'],
    ['fns/a.py', 'python'],
    ['fns/a.sh', 'shell'],
    ['fns/a.ts', null],
  ])('%s', (path, language) => {
    expect(codeFileLanguage(path)).toBe(language)
  })
})

const REF = fc.constantFrom(
  '<start.input>',
  '<agent1.content>',
  '<a.items[0].id>',
  '<a.items.0>',
  '<b.some-field>',
  '<loop.currentItem>',
  '<variable.retries>',
  '{{API_KEY}}',
  '{{B_2}}'
)
const WORD = fc.constantFrom('x', 'y', 'total', 'a b', "it's", '\\n', '<3', '>', '{', '}')

/** A small JS grammar with a reference in every quote context the resolver distinguishes. */
const STATEMENT = fc.oneof(
  fc.tuple(REF).map(([ref]) => `v = ${ref}`),
  fc.tuple(REF, REF).map(([a, b]) => `f(${a}, ${b})`),
  fc.tuple(WORD, REF).map(([w, ref]) => `s = '${w.replace(/['\\]/g, '')} ${ref}'`),
  fc.tuple(WORD, REF).map(([w, ref]) => `s = "${w.replace(/["\\]/g, '')} ${ref}"`),
  fc.tuple(WORD, REF, REF).map(([w, a, b]) => `s = \`${w.replace(/[`\\]/g, '')} ${a} \${${b}}\``),
  fc.tuple(REF).map(([ref]) => `// note ${ref}`),
  fc.tuple(REF).map(([ref]) => `/* ${ref} */`),
  fc.tuple(REF).map(([ref]) => `r = /${ref.replace(/[{}]/g, '')}/`),
  fc.tuple(REF).map(([ref]) => `if (ok) /${ref.replace(/[{}]/g, '')}/.test(s)`),
  fc.tuple(REF).map(([ref]) => `return (${ref}).length`),
  fc.tuple(REF).map(([ref]) => `x = { k: ${ref}, [${ref}]: 1 }`)
)
const PROGRAM = fc.array(STATEMENT, { minLength: 1, maxLength: 8 }).map((lines) => lines.join('\n'))

describe('code-file bijection over a small JS grammar', () => {
  it('reverses every program exactly and rewrites every code-position token', () => {
    fc.assert(
      fc.property(PROGRAM, (code) => {
        const check = checkCodeFileBijection(code, 'javascript')
        expect(check.ok).toBe(true)
        if (!check.ok) return
        expect(fromCodeFile(check.file, 'javascript')).toMatchObject({ ok: true, code })
        for (const line of check.file.split('\n')) {
          if (line.startsWith('v =') || line.startsWith('f(')) {
            expect(line).not.toMatch(/[<{]{1,2}[A-Za-z]/)
          }
        }
      }),
      { numRuns: 500 }
    )
  })

  it('never throws and never accepts a lossy file for arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (code) => {
        const check = checkCodeFileBijection(code, 'javascript')
        if (check.ok) {
          expect(fromCodeFile(check.file, 'javascript')).toMatchObject({ ok: true, code })
        }
      }),
      { numRuns: 1000 }
    )
  })
})

describe('code with carriage returns', () => {
  const CRLF_CODE = 'const a = 1\r\nreturn a\r\n'

  it('is not representable as a code file, which checkouts normalize to LF', () => {
    expect(checkCodeFileBijection(CRLF_CODE, 'javascript')).toEqual({ ok: false, reason: 'lossy' })
  })

  it('round-trips through print, an LF checkout, compile and materialize unchanged', () => {
    const prev = workflowState([
      blockState('f1', 'function', 'Fn', { language: 'javascript', code: CRLF_CODE }),
    ])
    const stored = canonical(prev).workflow
    const printed = printWorkflow({
      workflow: stored,
      catalog: CATALOG,
      options: { functionCode: 'files' },
    })
    for (const file of printed.files) expect(file.text).not.toContain('\r')
    const [entry, ...codeFiles] = printed.files
    if (!entry) throw new Error('expected an entry file')
    const compiled = compileWorkflow({
      entry,
      files: new Map(codeFiles.map((file) => [file.path, file.text.replace(/\r\n/g, '\n')])),
      catalog: CATALOG,
      sdkMajor: 1,
    })
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    if (!compiled.workflow) throw new Error('expected a workflow')
    const diff = diffCanonical(stored, compiled.workflow)
    expect(diff.blocks.modified).toEqual([])
    const result = materialize(compiled.workflow, null, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      resources: RESOURCES,
      prev,
      lockFreshness: 'none',
    })
    expect(result.state.blocks.f1?.subBlocks.code?.value).toBe(CRLF_CODE)
  })
})

describe('code file paths', () => {
  /** The folded spellings of `paths`: what a case-insensitive disk would hold them as. */
  const folded = (paths: string[]) => paths.map((path) => path.normalize('NFC').toLowerCase())

  it.each([
    ['the new block first', ['Fetch', 'Fetch data']],
    ['the hinted block first', ['Fetch data', 'Fetch']],
  ])('never prints two code files one case-insensitive disk holds as one: %s', (_label, order) => {
    const blocks = order.map((name, index) =>
      blockState(`f${index}`, 'function', name, {
        language: 'javascript',
        code: `return ${index}`,
      })
    )
    const stored = canonical(workflowState(blocks)).workflow
    const hinted = 'functions/Fetch.js'
    const print = () =>
      printWorkflow({
        workflow: stored,
        catalog: CATALOG,
        hints: { blocks: { fetchdata: { codeFile: hinted } } },
        options: { functionCode: 'files' },
      })
    const paths = print()
      .files.slice(1)
      .map((file) => file.path)
    expect(new Set(folded(paths)).size).toBe(paths.length)
    expect(print().hints.blocks.fetchdata?.codeFile).toBe(hinted)
    expect(print()).toEqual(print())
  })

  it.each(['lib/fetch.js', 'functions/.fetch.js', '.git/hooks/fetch.js'])(
    'prints a hinted path no workflow directory holds (%s) under functions/ instead',
    (hinted) => {
      const stored = canonical(
        workflowState([
          blockState('f0', 'function', 'Fetch data', { language: 'javascript', code: 'return 1' }),
        ])
      ).workflow
      const printed = printWorkflow({
        workflow: stored,
        catalog: CATALOG,
        hints: { blocks: { fetchdata: { codeFile: hinted } } },
        options: { functionCode: 'files' },
      })
      expect(printed.files.slice(1).map((file) => file.path)).toEqual(['functions/fetch-data.js'])
    }
  )
})
