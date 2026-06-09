/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SKILLS,
  getBuiltinSkillById,
  getBuiltinSkillByName,
  isBuiltinSkillId,
} from './builtin-skills'

describe('builtin skills', () => {
  it('ships the four template skills with stable ids and valid fields', () => {
    expect(BUILTIN_SKILLS.map((s) => s.id)).toEqual([
      'builtin-connect-integration',
      'builtin-research',
      'builtin-create-table',
      'builtin-deploy-workflow',
    ])
    for (const s of BUILTIN_SKILLS) {
      expect(s.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.content.length).toBeGreaterThan(0)
    }
  })

  it('resolves by id and name (case-insensitive) and reports membership', () => {
    expect(getBuiltinSkillById('builtin-research')?.name).toBe('research')
    expect(getBuiltinSkillByName('RESEARCH')?.id).toBe('builtin-research')
    expect(isBuiltinSkillId('builtin-deploy-workflow')).toBe(true)
    expect(isBuiltinSkillId('sk-some-db-id')).toBe(false)
    expect(getBuiltinSkillById('does-not-exist')).toBeUndefined()
  })
})
