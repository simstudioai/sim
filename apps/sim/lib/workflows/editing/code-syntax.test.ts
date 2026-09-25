/** @vitest-environment node */
import type { BlockState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { collectWorkflowCodeSyntax } from '@/lib/workflows/editing/code-syntax'

function block(code: string, language = 'javascript'): BlockState {
  return {
    id: 'renderer',
    type: 'function',
    name: 'Contract renderer',
    enabled: true,
    position: { x: 0, y: 0 },
    outputs: {},
    subBlocks: {
      code: { id: 'code', type: 'code', value: code },
      language: { id: 'language', type: 'dropdown', value: language },
    },
  }
}

describe('embedded Function syntax checks', () => {
  it('catches path replacements that turn a regex into invalid flags', async () => {
    const report = await collectWorkflowCodeSyntax({
      renderer: block('const imports = /import\\s+from/workspace/contracts;\nreturn imports'),
    })
    expect(report.issues).toEqual([
      expect.objectContaining({
        blockId: 'renderer',
        language: 'javascript',
        field: 'code',
        message: 'Invalid regular expression flags',
        line: 1,
      }),
    ])
  })

  it.each([
    'return await Promise.resolve({ ok: true })',
    'const params = 1; const environmentVariables = 2; return params + environmentVariables',
    'import path from "node:path";\nreturn path.join("files", "contracts")',
    'const value = <prior.result>; return value',
    'return "{{SECRET}}" + "<prior.result>"',
    'const expression = /abc/{{FLAGS}}; return expression',
    'const result = /import\\s+["\'](.+)["\']/g; return result',
    'if (1 < 2 && 4 > 3) return true',
  ])('accepts supported JavaScript without running it: %s', async (code) => {
    expect((await collectWorkflowCodeSyntax({ renderer: block(code) })).issues).toEqual([])
  })

  it('does not expose regex source fragments in diagnostics', async () => {
    const report = await collectWorkflowCodeSyntax({ renderer: block('return /PRIVATE-SECRET[/') })
    expect(report.issues).toHaveLength(1)
    expect(JSON.stringify(report)).not.toContain('PRIVATE-SECRET')
  })

  it.each([
    'return "value"PRIVATE_TOKEN',
    'const PRIVATE_TOKEN = 1; const PRIVATE_TOKEN = 2',
    'import path from "node:path";\nreturn "value"PRIVATE_TOKEN',
    'import path from "node:path";\nconst PRIVATE_TOKEN = 1; const PRIVATE_TOKEN = 2',
  ])('does not echo source tokens from native or import-parser diagnostics: %s', async (code) => {
    const report = await collectWorkflowCodeSyntax({ renderer: block(code) })
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]).toMatchObject({
      field: 'code',
      language: 'javascript',
      message: expect.stringContaining('Invalid JavaScript syntax'),
      line: code.includes('\n') ? 2 : 1,
      column: expect.any(Number),
    })
    expect(report.check.status).toBe('complete')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_TOKEN')
  })

  it('reports the runtime placeholder limit without failing the lint operation', async () => {
    const report = await collectWorkflowCodeSyntax({
      renderer: block(`return "${'{{KEY}}'.repeat(10001)}"`),
    })
    expect(report.issues[0].message).toContain('more than 10000 variable placeholders')
  })

  it('never evaluates side effects while checking code', async () => {
    const key = '__workflowLintExecuted'
    await collectWorkflowCodeSyntax({
      renderer: block(`globalThis.${key} = true; throw new Error('must not run')`),
    })
    expect(Reflect.get(globalThis, key)).toBeUndefined()
  })

  it.each(['const value = ;', 'return /[/;', 'const value: number = 1'])(
    'reports syntax failures: %s',
    async (code) => {
      expect((await collectWorkflowCodeSyntax({ renderer: block(code) })).issues).toHaveLength(1)
    }
  )

  it('states unsupported and disabled code coverage without misclassifying Python as JavaScript', async () => {
    const report = await collectWorkflowCodeSyntax({
      python: block('return {"name": True}', 'python'),
      shell: block('printf hello', 'shell'),
      disabled: { ...block('bad !!!'), enabled: false },
    })
    expect(report.issues).toEqual([])
    expect(report.check).toMatchObject({ status: 'partial' })
    expect(report.check.detail).toContain('Skipped 2 non-JavaScript bodies')
    expect(report.check.detail).toContain('Parsed 0')
  })

  it('marks parser-limit exhaustion as unchecked instead of failing an advisory write', async () => {
    const code = `import value from "some-module"; return ${'['.repeat(20000)}0${']'.repeat(20000)}`
    const report = await collectWorkflowCodeSyntax({ renderer: block(code) })
    expect(report.check.status).toBe('partial')
    expect(report.check.detail).toContain('1 bodies could not be parsed')
  })

  it('reports placeholder and byte-budget limits', async () => {
    const report = await collectWorkflowCodeSyntax({
      templated: block('return <prior.result>'),
      large: block(`${' '.repeat(1024 * 1024)}return 1`),
    })
    expect(report.issues).toEqual([])
    expect(report.check.status).toBe('partial')
    expect(report.check.detail).toContain('1 used placeholder values')
    expect(report.check.detail).toContain('1 bodies exceeding')
  })
})
