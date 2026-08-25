export interface SkillDraftShape {
  id: string
  name: string
  description: string
  content: string
}

export function skillDraftMatchesSource(
  draft: Pick<SkillDraftShape, 'name' | 'description' | 'content'>,
  source: SkillDraftShape
): boolean {
  return (
    draft.name === source.name &&
    draft.description === source.description &&
    draft.content === source.content
  )
}

export function skillSourceChanged(previous: SkillDraftShape, next: SkillDraftShape): boolean {
  return (
    previous.id !== next.id ||
    previous.name !== next.name ||
    previous.description !== next.description ||
    previous.content !== next.content
  )
}
