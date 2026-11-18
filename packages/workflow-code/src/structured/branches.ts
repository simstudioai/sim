/**
 * Condition and router rows (`condition-input`, `router-input`): canonicalize lifts them into
 * `CanonicalBlock.branches` (`canonicalize/branches.ts`), never into a param, so each param-level
 * hook is the plain one.
 */

import {
  compilePlain,
  encodePlain,
  liftPlain,
  noLockItems,
  printPlain,
  type StructuredCodec,
} from './codec'

export const BRANCHES_CODEC: StructuredCodec = {
  lift: liftPlain,
  varNodes: false,
  compileLiteral: compilePlain,
  print: printPlain,
  encode: encodePlain,
  lockItems: noLockItems,
}
