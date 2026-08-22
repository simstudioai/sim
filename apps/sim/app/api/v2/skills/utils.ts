import type { skill } from '@sim/db/schema'
import type { V2Skill, V2SkillSummary } from '@/lib/api/contracts/v2/skills'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import type { SkillSummaryRow } from '@/lib/workflows/skills/operations'

/** Shared serialization for the v2 skills surface. */
type SkillRow = typeof skill.$inferSelect

/**
 * List projection — no `content`; skill bodies are fetched per skill. It takes
 * the body-less row so the list query never has to load one.
 */
export function toV2SkillSummary(row: SkillSummaryRow): V2SkillSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    readOnly: isBuiltinSkillId(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Detail projection — the summary plus the skill body. */
export function toV2Skill(row: SkillRow): V2Skill {
  return { ...toV2SkillSummary(row), content: row.content }
}
