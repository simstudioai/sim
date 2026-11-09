/**
 * Field copy shared by every skill editing surface. The two pages share JSX via
 * `SkillFields`, but the canvas modal must frame its fields with
 * `ChipModalField` — required inside a `ChipModalBody` — so it cannot. These
 * strings are what keep the modal in step with the pages.
 */

export const SKILL_NAME_PLACEHOLDER = 'my-skill-name'
export const SKILL_NAME_HINT = 'Lowercase letters, numbers, and hyphens (e.g. my-skill)'
export const SKILL_DESCRIPTION_PLACEHOLDER = 'What this skill does and when to use it...'
export const SKILL_CONTENT_PLACEHOLDER = 'Skill instructions in markdown...'

/** Mirrors `skillDescriptionSchema` in the contract. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024
