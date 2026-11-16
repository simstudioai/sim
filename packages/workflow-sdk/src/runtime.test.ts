import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SDK_CORE_EXPORTS } from '@sim/workflow-code/sdk'
import type { BlockRetryConfig as StoredBlockRetryConfig } from '@sim/workflow-types/workflow'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { BlockRetryConfig } from './core'
import * as runtimeModule from './runtime'
import { SimSdkNotExecutable } from './runtime'

const runtime: Record<string, unknown> = { ...runtimeModule }

const coreValueExports = [
  ...readFileSync(path.join(import.meta.dirname, 'core.d.ts'), 'utf8').matchAll(
    /^export declare (?:function|const|namespace) ([A-Za-z_$][\w$]*)/gm
  ),
].map((match) => match[1])

describe('the SDK value surface', () => {
  it('core.d.ts declares exactly SDK_CORE_EXPORTS', () => {
    expect([...new Set(coreValueExports)].sort()).toEqual([...SDK_CORE_EXPORTS].sort())
  })

  it('the runtime exports exactly SDK_CORE_EXPORTS, plus the error class', () => {
    const names = Object.keys(runtime).filter((name) => name !== 'SimSdkNotExecutable')
    expect(names.sort()).toEqual([...SDK_CORE_EXPORTS].sort())
  })

  it('every runtime export throws SimSdkNotExecutable when called or read', () => {
    for (const name of SDK_CORE_EXPORTS) {
      const value: unknown = runtime[name]
      if (typeof value !== 'function') throw new Error(`${name} is not a stub`)
      expect(() => value('x')).toThrow(SimSdkNotExecutable)
      expect(() => Reflect.get(value, 'anything')).toThrow(SimSdkNotExecutable)
    }
  })

  it('BlockMeta.retry declares exactly the stored retry fields', () => {
    expectTypeOf<BlockRetryConfig>().toEqualTypeOf<StoredBlockRetryConfig>()
  })
})
