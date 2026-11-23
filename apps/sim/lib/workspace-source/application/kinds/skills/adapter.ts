/**
 * Skills as workspace source: `skills/<key>.md` holds a skill's name, description and content.
 * Every read and write goes through the skill use cases, so workspace API keys stay denied (the
 * kind's load refuses them at plan time) and an update or delete needs editor rights on that
 * skill, checked here before anything is written. Built-in skills live in code and are never
 * source.
 */
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { type SkillDecl, skillCodec, skillPath } from '@sim/workspace-code/kinds/skills'
import {
  createSkillUseCase,
  deleteSkillUseCase,
  getSkillUseCase,
  listAvailableSkillsUseCase,
  requireSkillEditorAccess,
  updateSkillUseCase,
} from '@/lib/skills/application/use-cases'
import { builtinNameCollision, skillFieldProblem } from '@/lib/skills/orchestration'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { kindFinding } from '@/lib/workspace-source/application/findings'
import { bindStored } from '@/lib/workspace-source/application/keys'
import {
  applyNamed,
  authorizeNamed,
  type NamedKind,
  planNamed,
  planNamedUndeclared,
  readRecord,
  storedFingerprint,
  writtenFields,
} from '@/lib/workspace-source/application/kinds/named'
import type {
  KindAdapter,
  PlannedChange,
  SourceContext,
} from '@/lib/workspace-source/application/types'

type SkillChange = PlannedChange<'skill'>

const skills: NamedKind<'skill', SkillDecl> = {
  kind: 'skill',
  codec: skillCodec,
  nameOf: (decl) => decl.name,
  declOf: ({ name, description, content }) => ({ name, description, content }),
}

async function getSkill(ctx: SourceContext, skillId: string): Promise<SkillDecl> {
  const { skill } = await getSkillUseCase.execute({
    principal: ctx.principal,
    input: { workspaceId: ctx.workspace.workspaceId, skillId },
  })
  return skills.declOf(skill)
}

const FIELDS: ReadonlyArray<keyof SkillDecl> = ['name', 'description', 'content']

/**
 * Refuses at plan time what the skill write would refuse mid-apply, on the fields the write sends
 * (all of them on a create, the changed ones otherwise): a field rule, or a rename onto a
 * built-in's name. A stored value an older rule admitted stays applicable while it is unchanged.
 */
function checkFields(change: SkillChange, decl: SkillDecl): void {
  const written = writtenFields(change)
  const finding = (code: 'E_DECL_SHAPE' | 'E_NAME_TAKEN', message: string) =>
    change.diagnostics.push(
      kindFinding('skill', change.key, code, message, { file: skillPath(change.key) })
    )
  for (const field of FIELDS) {
    if (!written.includes(field)) continue
    const problem = skillFieldProblem({ [field]: decl[field] })
    if (problem) finding('E_DECL_SHAPE', `${field}: ${problem}`)
  }
  const collision = written.includes('name') ? builtinNameCollision(decl.name) : null
  if (collision) finding('E_NAME_TAKEN', `${collision}.`)
}

export const skillAdapter: KindAdapter<'skill', SkillDecl> = {
  codec: skillCodec,

  async load(ctx, { allocate }) {
    const { skills: rows } = await listAvailableSkillsUseCase.execute({
      principal: ctx.principal,
      input: { workspaceId: ctx.workspace.workspaceId },
    })
    const records = rows
      .filter((row) => !isBuiltinSkillId(row.id))
      .map((row) => ({ id: row.id, name: row.name, state: skills.declOf(row) }))
    return bindStored(ctx, 'skill', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: SkillChange[] = []
    for (const [key, decl] of desired) {
      const change = planNamed(skills, key, decl, stored, desired, ctx, skillPath(key), claimed)
      checkFields(change, decl)
      changes.push(change)
    }
    return [...changes, ...planNamedUndeclared(skills, desired, stored, ctx, changes)]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    const requireEditor = (skillId: string) =>
      requireSkillEditorAccess(requirePrincipalSubjectUserId(principal), {
        workspaceId,
        skill: { id: skillId },
      })
    await authorizeNamed(change, {
      create: (decl) =>
        createSkillUseCase.authorize({ principal, input: { workspaceId, ...decl } }),
      async update(skillId) {
        await updateSkillUseCase.authorize({ principal, input: { workspaceId, skillId } })
        await requireEditor(skillId)
      },
      async remove(skillId) {
        await deleteSkillUseCase.authorize({ principal, input: { workspaceId, skillId } })
        await requireEditor(skillId)
      },
    })
  },

  async storedFingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A skill check needs the stored id')
    return storedFingerprint(skills, await getSkill(ctx, change.storedId))
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    return applyNamed(skills, change, {
      async create(decl) {
        const { skill } = await createSkillUseCase.execute({
          principal,
          input: { workspaceId, ...decl, source: 'api' },
        })
        return { id: skill.id, state: skills.declOf(skill) }
      },
      get: (skillId) => getSkill(ctx, skillId),
      async update(skillId, fields) {
        const { skill } = await updateSkillUseCase.execute({
          principal,
          input: { workspaceId, skillId, ...fields, source: 'api' },
        })
        return skills.declOf(skill)
      },
      async remove(skillId) {
        await deleteSkillUseCase.execute({
          principal,
          input: { workspaceId, skillId, source: 'api' },
        })
      },
    })
  },

  async read(stored) {
    return readRecord(skills, stored)
  },
}
