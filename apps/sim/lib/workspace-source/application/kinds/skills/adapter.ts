/**
 * Skills as workspace source: `skills/<key>.md` holds a skill's name, description and content.
 * Every read and write goes through the skill use cases, so workspace API keys stay denied (the
 * kind's load refuses them at plan time) and an update or delete needs editor rights on that
 * skill, checked here before anything is written. Built-in skills live in code and are never
 * source.
 */
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { type SkillDecl, skillCodec, skillPath } from '@sim/workspace-code/kinds/skills'
import type { z } from 'zod'
import {
  skillContentSchema,
  skillDescriptionSchema,
  skillNameSchema,
} from '@/lib/api/contracts/skills'
import {
  createSkillUseCase,
  deleteSkillUseCase,
  getSkillUseCase,
  listAvailableSkillsUseCase,
  requireSkillEditorAccess,
  updateSkillUseCase,
} from '@/lib/skills/application/use-cases'
import { getBuiltinSkillByName, isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { planUndeclared } from '@/lib/workspace-source/application/findings'
import {
  assertUnchanged,
  bindStored,
  declaredFinding,
  type NamedKind,
  type NamedPlan,
  planNamed,
  readRecord,
  writtenRecord,
} from '@/lib/workspace-source/application/kinds/named'
import type { KindAdapter, PlannedChange } from '@/lib/workspace-source/application/types'
import { claimResourceKey } from '@/lib/workspaces/resource-keys'

type SkillChange = PlannedChange<SkillDecl, NamedPlan>

const skills: NamedKind<SkillDecl, SkillDecl> = {
  kind: 'skill',
  codec: skillCodec,
  noun: 'skill',
  nameOf: (decl) => decl.name,
  declOf: ({ name, description, content }) => ({ name, description, content }),
}

/** The skill rules each field must meet, as the skill use cases check them on write. */
const FIELD_RULES: ReadonlyArray<[keyof SkillDecl, z.ZodType]> = [
  ['name', skillNameSchema],
  ['description', skillDescriptionSchema],
  ['content', skillContentSchema],
]

/** Refuses at plan time what the skill write would refuse mid-apply: a field rule, a built-in's name. */
function checkFields(change: SkillChange, decl: SkillDecl, renamed: boolean): void {
  const finding = (message: string, code = 'E_DECL_SHAPE') =>
    change.diagnostics.push(
      declaredFinding('skill', change.key, skillPath(change.key), code, message)
    )
  for (const [field, rule] of FIELD_RULES) {
    const parsed = rule.safeParse(decl[field])
    if (!parsed.success) finding(`${field}: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  if (renamed && getBuiltinSkillByName(decl.name)) {
    finding(`The skill name "${decl.name}" is reserved by a built-in skill.`, 'E_NAME_TAKEN')
  }
}

export const skillAdapter: KindAdapter<SkillDecl, SkillDecl, NamedPlan> = {
  codec: skillCodec,

  async load(ctx, { allocate }) {
    const { skills: rows } = await listAvailableSkillsUseCase.execute({
      principal: ctx.principal,
      input: { workspaceId: ctx.workspace.workspaceId },
    })
    const records = rows
      .filter((row) => !isBuiltinSkillId(row.id))
      .map((row) => ({ id: row.id, name: row.name, state: skills.declOf(row) }))
    return bindStored(ctx, 'skill', records, allocate)
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: SkillChange[] = []
    for (const [key, decl] of desired) {
      const change = planNamed(skills, key, decl, stored, ctx, skillPath(key), claimed)
      const previous = change.storedId
        ? [...stored.bound.values(), ...stored.unbound].find(
            (record) => record.id === change.storedId
          )
        : undefined
      checkFields(change, decl, previous?.name !== decl.name)
      changes.push(change)
    }
    return [
      ...changes,
      ...planUndeclared<SkillDecl, SkillDecl, NamedPlan>('skill', desired, stored, ctx, () => ({
        what: 'skill',
        counts: {},
      })),
    ]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create' && change.decl) {
      await createSkillUseCase.authorize({ principal, input: { workspaceId, ...change.decl } })
      return
    }
    const skillId = change.storedId
    if (!skillId) return
    if (change.action === 'delete') {
      await deleteSkillUseCase.authorize({ principal, input: { workspaceId, skillId } })
    } else {
      await updateSkillUseCase.authorize({ principal, input: { workspaceId, skillId } })
    }
    await requireSkillEditorAccess(requirePrincipalSubjectUserId(principal), {
      workspaceId,
      skill: { id: skillId },
    })
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A skill delete needs the stored skill id')
      await deleteSkillUseCase.execute({
        principal,
        input: { workspaceId, skillId: change.storedId, source: 'api' },
      })
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('A skill write needs its declaration')
    if (change.action === 'create') {
      const { skill } = await createSkillUseCase.execute({
        principal,
        input: { workspaceId, ...decl, source: 'api' },
      })
      await claimResourceKey({
        workspaceId,
        kind: 'skill',
        key: change.key,
        resourceId: skill.id,
        origin: 'created',
        createdBy: ctx.createdBy,
      })
      return writtenRecord(skills, change.key, { id: skill.id, state: skills.declOf(skill) })
    }
    const skillId = change.storedId
    if (!skillId) throw new Error('A skill update needs the stored skill id')
    const { skill: current } = await getSkillUseCase.execute({
      principal,
      input: { workspaceId, skillId },
    })
    assertUnchanged(skills, change, skills.declOf(current))
    if (change.action === 'adopt') {
      await claimResourceKey({
        workspaceId,
        kind: 'skill',
        key: change.key,
        resourceId: skillId,
        origin: 'adopted',
        createdBy: ctx.createdBy,
      })
    }
    const changed = change.detail?.changed ?? []
    if (changed.length === 0) {
      return writtenRecord(skills, change.key, { id: skillId, state: skills.declOf(current) })
    }
    /** Only the changed fields, so the write leaves the rest as the stale check saw them. */
    const pick = (field: keyof SkillDecl) => (changed.includes(field) ? decl[field] : undefined)
    const { skill } = await updateSkillUseCase.execute({
      principal,
      input: {
        workspaceId,
        skillId,
        name: pick('name'),
        description: pick('description'),
        content: pick('content'),
        source: 'api',
      },
    })
    return writtenRecord(skills, change.key, { id: skillId, state: skills.declOf(skill) })
  },

  async read(stored) {
    return readRecord(skills, stored)
  },
}
