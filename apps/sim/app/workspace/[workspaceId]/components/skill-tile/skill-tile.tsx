import { AgentSkillsIcon } from '@/components/icons'

/**
 * Square tile bearing the agent-skills glyph. Shared chrome for any surface
 * that lists a skill (the Skills page and integration detail pages) so the two
 * do not drift.
 */
export function SkillTile() {
  return (
    <div className='size-9 flex-shrink-0'>
      <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'>
        <AgentSkillsIcon className='size-5 text-[var(--text-icon)]' />
      </div>
    </div>
  )
}
