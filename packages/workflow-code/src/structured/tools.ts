/**
 * Tool lists (`tool-input`): canonicalize lifts a list of stored tool entries into the `tools`
 * param, which every later stage reads by param kind (`compile/tools.ts`, `print/tools.ts`,
 * `materialize/params.ts`). A list it cannot lift stays a plain value.
 */

import { liftTools } from '../canonicalize/tools'
import {
  compilePlain,
  encodePlain,
  liftPlain,
  noLockItems,
  printPlain,
  type StructuredCodec,
} from './codec'

export const TOOLS_CODEC: StructuredCodec = {
  lift(decoded, { overrides, blockKey, param, context }) {
    if (!Array.isArray(decoded)) return liftPlain()
    const tools = liftTools(decoded, overrides, blockKey, param, context)
    return tools ? { param: { kind: 'tools', tools } } : liftPlain()
  },
  varNodes: false,
  compileLiteral: compilePlain,
  print: printPlain,
  encode: encodePlain,
  lockItems: noLockItems,
}
