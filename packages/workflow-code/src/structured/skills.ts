/**
 * Agent skills (`skill-input`): each stored `{ skillId, name }` entry whose skill resolves becomes
 * a `skill` resource node, printed `skill('key')` and written back with the name the entry had.
 */

import { isRecordLike } from '@sim/utils/object'
import type { CanonContext } from '../canonicalize/context'
import { liftResourceId, toValue } from '../canonicalize/values'
import { isJson } from '../lock'
import type { MaterializeContext } from '../materialize/context'
import type { ParamSite } from '../materialize/params'
import { unliftValue } from '../materialize/values'
import { type BlockKey, isSimNode, type Value } from '../model'
import { arrayExpr } from '../print/syntax'
import { parseStoredList } from '../records'
import {
  compilePlain,
  encodePlain,
  liftPlain,
  noLockItems,
  printPlain,
  type StructuredCodec,
} from './codec'

/** A stored agent skill entry in the exact shape the skill picker writes: `{ skillId, name }`. */
function storedSkillEntry(item: unknown): { skillId: string; name: string } | null {
  if (!isRecordLike(item) || Object.keys(item).length !== 2) return null
  const { skillId, name } = item
  if (typeof skillId !== 'string' || skillId.trim() === '' || typeof name !== 'string') return null
  return { skillId, name }
}

/**
 * Each `{ skillId, name }` entry whose skill resolves becomes its `skill` resource node (the skills
 * encoding of `ResourceNode`). Any other entry stays a verbatim value; a skill id the resolver
 * misses is reported by `liftResourceId`, but a built-in skill's is not looked up at all, since it
 * never has a key.
 */
function liftSkills(
  list: unknown[],
  context: CanonContext,
  location: { blockKey: BlockKey; param: string }
): Value {
  return list.map((item) => {
    const entry = storedSkillEntry(item)
    if (entry && !context.resources?.isBuiltin?.('skill', entry.skillId)) {
      const node = liftResourceId('skill', entry.skillId, context, location)
      if (node.$sim === 'resource') return node
    }
    return toValue(item, context)
  })
}

/**
 * Each `skill` node is written as `{ skillId, name }`. The name is prev's for the same skill (so an
 * unchanged entry keeps its bytes), else the skill's current name from the resolver, else its key.
 * Every other entry is written as itself.
 */
function encodeSkills(list: Value[], site: ParamSite, context: MaterializeContext): unknown[] {
  const location = { blockKey: site.blockKey, param: site.param }
  const prevNames = new Map<string, string>()
  for (const item of parseStoredList(site.prevRaw) ?? []) {
    const entry = storedSkillEntry(item)
    if (entry && !prevNames.has(entry.skillId)) prevNames.set(entry.skillId, entry.name)
  }
  return list.map((item) => {
    const skillId = unliftValue(item, context, location)
    const isSkill = isSimNode(item) && item.$sim === 'resource' && item.kind === 'skill'
    if (!isSkill || typeof skillId !== 'string') return skillId
    const name = prevNames.get(skillId) ?? context.resources?.nameOf?.('skill', skillId) ?? item.key
    return { skillId, name }
  })
}

export const SKILLS_CODEC: StructuredCodec = {
  lift(decoded, { blockKey, param, context }) {
    if (!Array.isArray(decoded)) return liftPlain()
    return { param: { kind: 'value', value: liftSkills(decoded, context, { blockKey, param }) } }
  },
  varNodes: false,
  compileLiteral: compilePlain,
  print(value, { values, context }) {
    if (!Array.isArray(value)) return printPlain()
    // `SkillRef[]` types only `skill('key')`; an entry kept verbatim prints as `raw(...)`.
    return arrayExpr(
      value.map((item) =>
        !isSimNode(item) && isJson(item)
          ? values.call('raw', [values.json(item)])
          : values.value(item, context)
      )
    )
  },
  encode(value, site, context) {
    return Array.isArray(value)
      ? encodeSkills(value, site, context)
      : encodePlain(value, site, context)
  },
  lockItems: noLockItems,
}
