/**
 * @vitest-environment node
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { stripTypes } from '@/lib/execution/typescript'

function run(source: string): unknown {
  const stripped = stripTypes(`(() => {\n${source}\n})()`)
  if ('errors' in stripped) throw new Error(JSON.stringify(stripped.errors))
  return runInNewContext(stripped.code)
}

describe('stripTypes', () => {
  it('removes annotations, interfaces and assertions but keeps the values they wrap', () => {
    expect(
      run(`interface Row { id: string }
const rows = [{ id: 'a' }] as const satisfies readonly Row[]
const first: Row | undefined = rows[0]!
return rows.map((row): string => row.id).concat(first ? [first.id] : [])`)
    ).toEqual(['a', 'a'])
  })

  it('compiles the TypeScript constructs that have a runtime value', () => {
    expect(run('enum Color { Red, Blue }\nreturn [Color.Blue, Color[0]]')).toEqual([1, 'Red'])
  })

  it('keeps every line where it was written, so runtime positions match the source', () => {
    const stripped = stripTypes('type A = {\n  a: number\n}\nconst value: A = { a: 1 }\nvalue.b()')
    expect('code' in stripped && stripped.code.split('\n')[4]).toBe('value.b()')
  })

  it('reports a program that does not parse with the line of each error', () => {
    expect(stripTypes('const a = 1\nconst b: = 2')).toEqual({
      errors: [{ line: 2, message: expect.stringContaining('Unexpected token') }],
    })
    expect(stripTypes('let a = 1\nlet a = 2\nlet b = 1\nlet b = 2')).toEqual({
      errors: [
        { line: 2, message: "Identifier 'a' has already been declared." },
        { line: 4, message: "Identifier 'b' has already been declared." },
      ],
    })
  })
})
