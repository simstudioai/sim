import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SimSdkNotExecutable } from '../runtime'
import * as runtimeModule from './runtime'

const runtime: Record<string, unknown> = { ...runtimeModule }

const DECLARATIONS = readdirSync(import.meta.dirname)
  .filter((file) => file.endsWith('.d.ts'))
  .map((file) => readFileSync(path.join(import.meta.dirname, file), 'utf8'))
  .join('\n')

/** Every value `@sim/workflow-sdk/workspace` declares: its own and those re-exported from core. */
const declaredValues = [
  ...new Set([
    ...[...DECLARATIONS.matchAll(/^export declare (?:function|const) ([A-Za-z_$][\w$]*)/gm)].map(
      (match) => match[1]
    ),
    ...[...DECLARATIONS.matchAll(/^export \{([^}]*)\} from '@sim\/workflow-sdk'/gm)].flatMap(
      (match) => match[1].split(',').map((name) => name.trim())
    ),
  ]),
].sort()

describe('the workspace SDK runtime', () => {
  it('exports every value the declarations declare, so running a declaration file names it', () => {
    expect(Object.keys(runtime).sort()).toEqual(declaredValues)
  })

  it('every export throws SimSdkNotExecutable when called', () => {
    for (const name of declaredValues) {
      const value: unknown = runtime[name]
      const target: unknown =
        name === 'column' ? Reflect.get(runtimeModule.column, 'string') : value
      if (typeof target !== 'function') throw new Error(`${name} is not a stub`)
      expect(() => target({}), name).toThrow(SimSdkNotExecutable)
    }
  })
})
