import { describe, expect, it } from 'vitest'
import { skillDraftMatchesSource, skillSourceChanged } from './skill-draft-sync'

const source = {
  id: 'skill-1',
  name: 'writer',
  description: 'Original description',
  content: 'Original content',
}

describe('Skill draft synchronization', () => {
  it('recognizes a clean draft that can follow an external update', () => {
    expect(skillDraftMatchesSource(source, source)).toBe(true)
    expect(skillSourceChanged(source, { ...source, description: 'Updated by Mothership' })).toBe(
      true
    )
  })

  it('preserves a locally edited draft during an external update', () => {
    expect(skillDraftMatchesSource({ ...source, content: 'Unsaved local content' }, source)).toBe(
      false
    )
  })
})
