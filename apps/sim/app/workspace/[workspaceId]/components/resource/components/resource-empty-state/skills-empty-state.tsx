import { EmptyState } from '@/components/empty-state/empty-state'
import {
  Bar,
  Vignette,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

/** Tool-pill widths inside the skill card — a skill is a bundle of tools. */
const TOOL_PILLS = [38, 30, 44] as const

/**
 * A skill card over its stack, opened far enough to show the tools bundled
 * inside it — the card is the unit you install, the pills are what it brings.
 */
function SkillsGraphic() {
  return (
    <Vignette>
      <span className='absolute top-[40px] left-[92px] h-[84px] w-[152px] rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] opacity-45' />
      <span className='absolute top-[34px] left-[86px] h-[84px] w-[160px] rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-2)] opacity-75' />

      <div className='absolute top-[26px] left-[76px] h-[92px] w-[168px] rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-2)] p-3.5'>
        <div className='flex items-center gap-2.5'>
          <span className='size-[26px] shrink-0 rounded-[7px] bg-[var(--surface-5)]' />
          <span className='flex flex-col gap-[6px]'>
            <Bar className='h-2 w-[72px]' />
            <Bar className='h-[6px] w-[46px]' />
          </span>
        </div>

        <div className='mt-3 space-y-[7px]'>
          <Bar className='h-2 w-[136px]' />
          <Bar className='h-2 w-[104px]' />
        </div>

        <div className='mt-3 flex items-center gap-1.5'>
          {TOOL_PILLS.map((width) => (
            <span
              key={width}
              className='flex h-[14px] items-center gap-1 rounded-full bg-[var(--surface-4)] px-1.5'
              style={{ width }}
            >
              <span className='size-[6px] shrink-0 rounded-full bg-[var(--surface-6)]' />
            </span>
          ))}
        </div>
      </div>
    </Vignette>
  )
}

/** Empty state for the skills list when the workspace has none installed. */
export function SkillsEmptyState() {
  return (
    <EmptyState
      graphic={<SkillsGraphic />}
      title='No skills yet'
      description='Add a skill to give your agents a packaged set of tools to work with.'
    />
  )
}
