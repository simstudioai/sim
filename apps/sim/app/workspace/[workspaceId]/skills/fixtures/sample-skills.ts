import type { SkillDefinition } from '@/hooks/queries/skills'

/**
 * Flip to `true` to seed the Skills page with the sample entries below
 * so every workspace has a populated list out of the box.
 */
export const PREVIEW_SKILLS_WITH_SAMPLES = true

/**
 * Four out-of-the-box sample skills shown alongside any real skills the
 * workspace has created. Each entry covers a distinct everyday agent task.
 */
export function getSampleSkills(workspaceId: string): SkillDefinition[] {
  const now = new Date().toISOString()
  const base = {
    workspaceId,
    userId: null,
    createdAt: now,
    updatedAt: now,
  }
  return [
    {
      ...base,
      id: 'sample-skill-summarize-thread',
      name: 'summarize-thread',
      description: 'Condense a long Slack or email thread into the key decisions and action items.',
      content:
        '# Summarize Thread\n\nGiven a Slack or email thread, produce:\n- A 1-sentence TL;DR\n- Key decisions made\n- Action items with owners\n- Open questions',
    },
    {
      ...base,
      id: 'sample-skill-triage-inbox',
      name: 'triage-inbox',
      description:
        'Sort incoming messages by urgency and draft replies for the highest priority items.',
      content:
        '# Triage Inbox\n\nFor each unread message:\n1. Classify as Urgent / Today / This week / FYI\n2. For Urgent + Today, draft a reply\n3. Suggest a calendar block if a meeting is needed',
    },
    {
      ...base,
      id: 'sample-skill-write-changelog',
      name: 'write-changelog',
      description: 'Turn a list of merged pull requests into a customer-facing changelog entry.',
      content:
        '# Write Changelog\n\nGiven a list of merged PRs, write a changelog entry:\n- Group by area (Features, Improvements, Fixes)\n- Plain-English titles\n- One-line descriptions, no jargon',
    },
    {
      ...base,
      id: 'sample-skill-prep-standup',
      name: 'prep-standup',
      description:
        'Pull yesterday’s commits, tickets, and meetings into a ready-to-paste standup update.',
      content:
        '# Prep Standup\n\nProduce a 3-section update:\n- Yesterday: commits, closed tickets, completed meetings\n- Today: in-progress work, scheduled meetings\n- Blockers: anything waiting on someone else',
    },
  ]
}
