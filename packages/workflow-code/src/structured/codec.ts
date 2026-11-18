/**
 * The contract every structured subBlock kind whose value stays a param meets: one hook per stage
 * that treats the kind's value specially, each one called by that stage. `structured/index.ts`
 * holds one codec per such kind in a total record, so a new kind does not type-check until each
 * stage's hook is chosen. A stage that needs nothing special uses the plain hook named for it here.
 * The kinds lifted into their own model shape (`tools`, `branches`) have no codec.
 */

import type { Node } from '@babel/types'
import type { CanonContext } from '../canonicalize/context'
import type { CanonicalModeOverrides } from '../catalog/canonical-index'
import type { CompileContext } from '../compile/context'
import type { LockItem } from '../lock'
import type { MaterializeContext } from '../materialize/context'
import type { ParamSite } from '../materialize/params'
import { unliftValue } from '../materialize/values'
import type { BlockKey, CanonicalParam, SubBlockId, Value } from '../model'
import type { FieldContext, PrintedValue, ValuePrinter } from '../print/values'

/** Where canonicalize lifts a stored value. */
interface LiftSite {
  blockKey: BlockKey
  param: SubBlockId
  overrides: CanonicalModeOverrides | undefined
  context: CanonContext
}

/** A lifted param, with the lock items it moves out of the value. */
interface LiftedParam {
  param: CanonicalParam
  items?: LockItem[]
}

/** Where compile checks a literal written for the field. */
interface LiteralSite {
  ctx: CompileContext
  node: Node
  blockKey: BlockKey
}

/** What the printer offers a structured value. */
interface StructuredPrintSite {
  values: ValuePrinter
  context: FieldContext
  block: BlockKey
}

/** One structured kind's behavior in each stage. */
export interface StructuredCodec {
  /** Canonicalize: the decoded stored value as a param, or `null` for the plain lift. */
  lift(decoded: unknown, site: LiftSite): LiftedParam | null
  /** Compile and print: a bare `vars.x` written in the field is the variable itself. */
  varNodes: boolean
  /** Compile: a literal written for the field, checked and normalized to the stored shape. */
  compileLiteral(value: Value, site: LiteralSite): Value
  /** Print: the value's own form, or `null` for the plain one. */
  print(value: Value, site: StructuredPrintSite): PrintedValue | null
  /** Materialize: the value as stored JSON, before its storage encoding. */
  encode(value: Value, site: ParamSite, context: MaterializeContext): unknown
  /** Materialize: the lock items a stored value carries. */
  lockItems(stored: unknown): LockItem[]
}

/** Canonicalize's plain lift applies. */
export function liftPlain(): null {
  return null
}

/** The written literal is stored as written. */
export function compilePlain(value: Value): Value {
  return value
}

/** The printer's plain form applies. */
export function printPlain(): null {
  return null
}

/** The value's ids written back, with no other change. */
export function encodePlain(value: Value, site: ParamSite, context: MaterializeContext): unknown {
  return unliftValue(value, context, { blockKey: site.blockKey, param: site.param })
}

/** The stored value carries no lock items. */
export function noLockItems(): LockItem[] {
  return []
}
