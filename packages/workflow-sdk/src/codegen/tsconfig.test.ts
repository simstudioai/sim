import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { typecheckCommand } from './tsconfig'

describe('typecheckCommand', () => {
  it('runs the TypeScript release this repository type-checks the generated declarations with', () => {
    const { version } = createRequire(import.meta.url)('typescript/package.json')
    expect(typecheckCommand()).toBe(`bunx -p typescript@${version} tsc -p .`)
  })
})
