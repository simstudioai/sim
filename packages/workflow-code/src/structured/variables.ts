/**
 * Variable assignments (`variables-input`): each `variableId` is the variable itself, lifted to a
 * `var` node, and a bare `vars.x` written in the field compiles to that node (compile/SYNTAX.md).
 */

import { isRecordLike } from '@sim/utils/object'
import type { CanonContext } from '../canonicalize/context'
import { toValue } from '../canonicalize/values'
import { diagnostic } from '../diagnostics/factory'
import type { BlockKey, Value } from '../model'
import { setOwn } from '../records'
import { compilePlain, encodePlain, noLockItems, printPlain, type StructuredCodec } from './codec'

/**
 * Each `variableId` becomes a `var` node keyed by the variable's key (sites as
 * `remapVariableAssignment` walks them). An id naming no variable stays an `unresolved` node with
 * `W_CANON_UNRESOLVED_ID`.
 */
function liftVariableAssignments(
  value: unknown,
  blockKey: BlockKey,
  param: string,
  context: CanonContext
): Value {
  if (Array.isArray(value)) {
    return value.map((item) => liftVariableAssignments(item, blockKey, param, context))
  }
  if (!isRecordLike(value) || Object.hasOwn(value, '$sim')) return toValue(value, context)
  const result: Record<string, Value> = {}
  for (const [key, member] of Object.entries(value)) {
    if (member === undefined) continue
    if (key === 'variableId' && typeof member === 'string') {
      const variableKey = context.variableKeyById.get(member)
      if (variableKey !== undefined) {
        setOwn(result, key, { $sim: 'var', key: variableKey })
      } else {
        context.diagnostics.push(
          diagnostic(
            'W_CANON_UNRESOLVED_ID',
            `Variable assignment names unknown variable id "${member}"; kept verbatim`,
            {
              blockKey,
              param,
            }
          )
        )
        setOwn(result, key, { $sim: 'unresolved', kind: 'var', id: member })
      }
      continue
    }
    setOwn(result, key, liftVariableAssignments(member, blockKey, param, context))
  }
  return result
}

export const VARIABLES_CODEC: StructuredCodec = {
  lift(decoded, { blockKey, param, context }) {
    return {
      param: { kind: 'value', value: liftVariableAssignments(decoded, blockKey, param, context) },
    }
  },
  varNodes: true,
  compileLiteral: compilePlain,
  print: printPlain,
  encode: encodePlain,
  lockItems: noLockItems,
}
