import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { SOURCE_TYPESCRIPT_VERSION } from './tsconfig'

describe('SOURCE_TYPESCRIPT_VERSION', () => {
  it('is the TypeScript release this repository type-checks the generated declarations with', () => {
    const { version } = createRequire(import.meta.url)('typescript/package.json')
    expect(SOURCE_TYPESCRIPT_VERSION).toBe(version)
  })
})
