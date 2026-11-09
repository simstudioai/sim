import { AgentSkillsIcon } from '@/components/icons'
import { ResourceTile } from '@/components/resource-tile'

/**
 * Square tile bearing the agent-skills glyph. Shared chrome for any surface
 * that lists a skill (the Skills page and integration detail pages) so the two
 * do not drift.
 */
export function SkillTile() {
  return <ResourceTile icon={AgentSkillsIcon} />
}
