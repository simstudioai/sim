'use client'

import { TextAreaField, TextField } from '@sim/emcn/field'
import {
  type ParsedSkill,
  parseSkillMarkdown,
  SKILL_DESCRIPTION_MAX_LENGTH,
  validateSkillName,
} from '@/platform/lib/data/skills'

export type SkillDraft = Pick<ParsedSkill, 'name' | 'description' | 'content'>
export type SkillErrors = Partial<Record<keyof SkillDraft, string>>

/** A skill can be saved once it has a valid name, a description and instructions. */
export function validateSkillDraft(draft: SkillDraft): SkillErrors {
  const errors: SkillErrors = {}
  const nameError = validateSkillName(draft.name)
  if (nameError) errors.name = nameError
  if (!draft.description.trim()) errors.description = 'Description is required'
  if (!draft.content.trim()) errors.content = 'Content is required'
  return errors
}

interface SkillFieldsProps {
  draft: SkillDraft
  errors?: SkillErrors
  /** The next draft and the fields that changed, so their errors can clear. */
  onEdit: (next: SkillDraft, changed: readonly (keyof SkillDraft)[]) => void
  viewOnly?: boolean
  disabled?: boolean
  /** Guidance under the name, such as why the skill cannot be edited. */
  nameHint?: string
}

/**
 * A skill's name, description and instructions. A full SKILL.md typed or pasted into the
 * instructions fills every field from its frontmatter.
 */
export function SkillFields({
  draft,
  errors = {},
  onEdit,
  viewOnly = false,
  disabled = false,
  nameHint,
}: SkillFieldsProps) {
  function editContent(value: string) {
    const parsed = parseSkillMarkdown(value)
    if (!parsed.nameFromFrontmatter) return onEdit({ ...draft, content: value }, ['content'])
    onEdit({ name: parsed.name, description: parsed.description, content: parsed.content }, [
      'name',
      'description',
      'content',
    ])
  }
  return (
    <>
      <TextField
        label='Name'
        name='name'
        placeholder='Skill name'
        hint={nameHint}
        error={errors.name}
        value={draft.name}
        onChange={(name) => onEdit({ ...draft, name }, ['name'])}
        viewOnly={viewOnly}
        disabled={disabled}
        required
        maxLength={64}
      />
      <TextAreaField
        label='Description'
        name='description'
        placeholder='Describe what this is for'
        error={errors.description}
        value={draft.description}
        onChange={(description) => onEdit({ ...draft, description }, ['description'])}
        viewOnly={viewOnly}
        disabled={disabled}
        required
        maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
      />
      <TextAreaField
        label='Instructions'
        name='content'
        placeholder='Describe what this skill should do'
        defaultSize='large'
        error={errors.content}
        value={draft.content}
        onChange={editContent}
        viewOnly={viewOnly}
        disabled={disabled}
        required
      />
    </>
  )
}
