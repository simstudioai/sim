/**
 * Field copy shared by every skill editing surface — the canvas modal and the
 * create/detail pages. The modal frames its fields with `ChipModalField` and the
 * pages with `DetailSection`, so they cannot share JSX; keeping the strings here
 * is what stops the three from drifting apart.
 */

export const SKILL_NAME_PLACEHOLDER = 'my-skill-name'
export const SKILL_NAME_HINT = 'Lowercase letters, numbers, and hyphens (e.g. my-skill)'
export const SKILL_DESCRIPTION_PLACEHOLDER = 'What this skill does and when to use it...'
export const SKILL_CONTENT_PLACEHOLDER = 'Skill instructions in markdown...'

/** Mirrors `skillDescriptionSchema` in the contract. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024
