import type { skill } from '@sim/db/schema'
import type { NextResponse } from 'next/server'
import type { V2Skill, V2SkillSummary } from '@/lib/api/contracts/v2/skills'
import type { SkillOrchestrationErrorCode } from '@/lib/skills/orchestration'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Shared serialization + error mapping for the v2 skills surface.
 */

type SkillRow = typeof skill.$inferSelect

/** List projection — no `content`; skill bodies are fetched per skill. */
export function toV2SkillSummary(row: SkillRow): V2SkillSummary {
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

/** Renders a skill orchestration failure in the v2 error envelope. */
export function v2SkillOrchestrationError(
  errorCode: SkillOrchestrationErrorCode | undefined,
  message: string
): NextResponse {
  switch (errorCode) {
    case 'validation':
      return v2Error('BAD_REQUEST', message)
    case 'forbidden':
      return v2Error('FORBIDDEN', message)
    case 'not_found':
      return v2Error('NOT_FOUND', 'Skill not found')
    case 'conflict':
      return v2Error('CONFLICT', message)
    default:
      return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
}
