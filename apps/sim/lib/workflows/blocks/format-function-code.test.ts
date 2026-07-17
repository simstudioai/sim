/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import { formatFunctionCode } from '@/lib/workflows/blocks/format-function-code'

describe('formatFunctionCode', () => {
  it('formats compact JavaScript while preserving Sim references', async () => {
    const code =
      'const items=<start.items>;return items.map((item)=>({id:item.id,description:item.description,status:item.status,source:item.source,value:{{DEFAULT_VALUE}}}));'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code: `const items = <start.items>;
return items.map((item) => ({
  id: item.id,
  description: item.description,
  status: item.status,
  source: item.source,
  value: {{DEFAULT_VALUE}},
}));`,
      changed: true,
      error: null,
    })
  })

  it('reports invalid JavaScript without changing it', async () => {
    const code = 'if ('
    const result = await formatFunctionCode(code, CodeLanguage.JavaScript)

    expect(result.code).toBe(code)
    expect(result.changed).toBe(false)
    expect(result.error).toEqual(expect.any(String))
  })

  it('reports when JavaScript is already formatted', async () => {
    const code = 'const value = 1;\nreturn value;'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code,
      changed: false,
      error: null,
    })
  })

  it('preserves whitespace-only code', async () => {
    const code = ' \n\t'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code,
      changed: false,
      error: null,
    })
  })

  it('does not confuse JavaScript comparisons with Sim references', async () => {
    const cases = [
      ['a <b> c', 'a < b > c'],
      ['a <b> -1', 'a < b > -1'],
      ["a <b> 'value'", "a < b > 'value'"],
      ['a <b> !c', 'a < b > !c'],
      ["'left' <b> value", "'left' < b > value"],
      ['`left` <b> value', '`left` < b > value'],
      ['π <b> δ', 'π < b > δ'],
    ]

    for (const [comparison, expectedComparison] of cases) {
      const code = `const input=<start.value>;const result=${comparison};return {input,result};`

      await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
        code: `const input = <start.value>;
const result = ${expectedComparison};
return { input, result };`,
        changed: true,
        error: null,
      })
    }
  })

  it('preserves indexed and hyphenated Sim references', async () => {
    const code = 'const item=<block-1.items[0]>;return {item};'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'const item = <block-1.items[0]>;\nreturn { item };',
      changed: true,
      error: null,
    })
  })

  it('restores large reference sets without placeholder collisions', async () => {
    const referenceCount = 1_300
    const code = `return [${Array.from({ length: referenceCount }, () => '<a>').join(',')}];`

    const result = await formatFunctionCode(code, CodeLanguage.JavaScript)

    expect(result.error).toBeNull()
    expect(result.code.match(/<a>/g)).toHaveLength(referenceCount)
    expect(result.code).not.toMatch(/<a>[0-9a-z_]/)
  })

  it('does not confuse bit shifts with Sim references', async () => {
    const code = 'const input=<start.value>;return a<<b>>c;'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'const input = <start.value>;\nreturn (a << b) >> c;',
      changed: true,
      error: null,
    })
  })

  it('preserves statement boundaries around Sim references', async () => {
    const code = 'const items=<start.items>;[1,2].forEach(console.log);'

    await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'const items = <start.items>;\n[1, 2].forEach(console.log);',
      changed: true,
      error: null,
    })
  })

  it('preserves Sim references after JavaScript grammar keywords', async () => {
    const cases = [
      [
        'for (const item of <source.items>.values) {console.log(item);}',
        'for (const item of <source.items>.values) {\n  console.log(item);\n}',
      ],
      [
        'if (item in <source.map>.values) {console.log(item);}',
        'if (item in <source.map>.values) {\n  console.log(item);\n}',
      ],
      [
        'if (item instanceof <source.ctor>.value) {console.log(item);}',
        'if (item instanceof <source.ctor>.value) {\n  console.log(item);\n}',
      ],
      [
        'if (ok) doThing(); else <source.fn>.value();',
        'if (ok) doThing();\nelse <source.fn>.value();',
      ],
      ['do <source.fn>.value(); while (ready);', 'do <source.fn>.value();\nwhile (ready);'],
      [
        'class Child extends <source.base>.value {run(){return true;}}',
        'class Child extends <source.base>.value {\n  run() {\n    return true;\n  }\n}',
      ],
    ]

    for (const [code, expectedCode] of cases) {
      await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
        code: expectedCode,
        changed: expectedCode !== code,
        error: null,
      })
    }
  })

  it('formats Python Function bodies while preserving Sim references', async () => {
    const code =
      'value=<start.value>\nresult={"value":value,"fallback":{{DEFAULT_VALUE}},"items":[1,2,3]}\nreturn result'

    await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
      code: `value = <start.value>
result = {"value": value, "fallback": {{DEFAULT_VALUE}}, "items": [1, 2, 3]}
return result`,
      changed: true,
      error: null,
    })
  })

  it('reports invalid Python without changing it', async () => {
    const code = 'if ('
    const result = await formatFunctionCode(code, CodeLanguage.Python)

    expect(result.code).toBe(code)
    expect(result.changed).toBe(false)
    expect(result.error).toEqual(expect.any(String))
  })

  it('reports when Python is already formatted', async () => {
    const code = 'value = {"foo": 1}\nreturn value'

    await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
      code,
      changed: false,
      error: null,
    })
  })

  it('preserves Python references around boolean and conditional keywords', async () => {
    const code = 'return <a.value> if <b.value> and not <c.value> else <d.value>'

    const result = await formatFunctionCode(code, CodeLanguage.Python)

    expect(result).toEqual({ code, changed: false, error: null })
  })

  it('keeps Python boundary keywords language-specific', async () => {
    const cases = [
      ['and', 'or'],
      ['assert', 'raise'],
      ['del', 'after'],
    ]

    for (const [left, right] of cases) {
      await expect(
        formatFunctionCode(`return ${left} <item.value> ${right};`, CodeLanguage.JavaScript)
      ).resolves.toEqual({
        code: `return ${left} < item.value > ${right};`,
        changed: true,
        error: null,
      })
    }
  })
})
