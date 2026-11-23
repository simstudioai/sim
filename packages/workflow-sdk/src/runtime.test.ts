import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BLOCK_META_KEYS, type BlockMetaKey, SDK_CORE_EXPORTS } from '@sim/workflow-code/sdk'
import type {
  BlockRetryConfig as StoredBlockRetryConfig,
  VariableType as StoredVariableType,
} from '@sim/workflow-types/workflow'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { BlockMeta, BlockRetryConfig, VariableType } from './core'
import * as runtimeModule from './runtime'
import { SimSdkNotExecutable } from './runtime'
import * as workspaceRuntime from './workspace/runtime'

const runtime: Record<string, unknown> = { ...runtimeModule }

const CORE = readFileSync(path.join(import.meta.dirname, 'core.d.ts'), 'utf8')

const coreValueExports = [
  ...CORE.matchAll(/^export declare (?:function|const|namespace) ([A-Za-z_$][\w$]*)/gm),
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
      expect(() => Reflect.construct(value, [])).toThrow(SimSdkNotExecutable)
      expect(() => Reflect.get(value, 'anything')).toThrow(SimSdkNotExecutable)
    }
  })

  it('every workspace runtime export throws SimSdkNotExecutable when called or constructed', () => {
    for (const [name, value] of Object.entries(workspaceRuntime)) {
      if (name === 'column') {
        const string: unknown = Reflect.get(workspaceRuntime.column, 'string')
        if (typeof string !== 'function') throw new Error('column.string is not a stub')
        expect(() => string()).toThrow(SimSdkNotExecutable)
        continue
      }
      if (typeof value !== 'function') throw new Error(`${name} is not a stub`)
      expect(() => value()).toThrow(SimSdkNotExecutable)
      expect(() => Reflect.construct(value, [])).toThrow(SimSdkNotExecutable)
    }
  })

  it('BlockMeta declares exactly the meta keys the printer writes and the compiler reads', () => {
    expectTypeOf<keyof BlockMeta>().toEqualTypeOf<BlockMetaKey>()
    const declared = /^export interface BlockMeta \{\n([\s\S]*?)^\}/m.exec(CORE)?.[1] ?? ''
    const keys = [...declared.matchAll(/^ {2}(\w+)\?:/gm)].map((match) => match[1])
    expect(keys.sort()).toEqual([...BLOCK_META_KEYS].sort())
  })

  it('BlockMeta.retry declares exactly the stored retry fields', () => {
    expectTypeOf<BlockRetryConfig>().toEqualTypeOf<StoredBlockRetryConfig>()
  })

  it('VariableType declares exactly the stored variable types', () => {
    expectTypeOf<VariableType>().toEqualTypeOf<StoredVariableType>()
  })
})
