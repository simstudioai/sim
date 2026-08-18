import { EmptyState } from '@/components/empty-state/empty-state'
import {
  Bar,
  Vignette,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

/** Name and size skeleton widths for the files already sitting in the folder. */
const FOLDER_FILES = [
  { name: 84, size: 22 },
  { name: 62, size: 18 },
] as const

/**
 * A folder held open with one file still in the air above its dashed landing
 * slot — Files is the one resource whose empty state is really an invitation to
 * drop something, so the graphic draws the gesture rather than the result.
 */
function FilesGraphic() {
  return (
    <Vignette>
      <span className='absolute top-[30px] left-[54px] h-[16px] w-[64px] rounded-t-[8px] border-[var(--border-1)] border-x border-t bg-[var(--surface-3)]' />

      <div className='absolute top-[42px] left-[54px] h-[92px] w-[208px] rounded-[8px] rounded-tl-none border border-[var(--border-1)] bg-[var(--surface-2)] px-3 pt-3'>
        {FOLDER_FILES.map((file) => (
          <div key={file.name} className='mb-[10px] flex items-center gap-2'>
            <span className='size-[14px] shrink-0 rounded-[3px] bg-[var(--surface-5)]' />
            <Bar className='h-2' style={{ width: file.name }} />
            <Bar className='ml-auto h-2' style={{ width: file.size }} />
          </div>
        ))}

        <span className='block h-[26px] w-full rounded-[6px] border border-[var(--brand-secondary)] border-dashed opacity-60' />
      </div>

      <div className='-rotate-6 absolute top-[10px] left-[178px] flex h-[36px] w-[108px] items-center gap-2 rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-1)] px-2.5 shadow-lg'>
        <span className='size-[16px] shrink-0 rounded-[4px] bg-[color-mix(in_srgb,var(--brand-secondary)_28%,transparent)]' />
        <span className='flex flex-col gap-[5px]'>
          <Bar className='h-2 w-[54px]' />
          <Bar className='h-[6px] w-[32px]' />
        </span>
      </div>
    </Vignette>
  )
}

/** Empty state for the files list when the workspace has none. */
export function FilesEmptyState() {
  return (
    <EmptyState
      graphic={<FilesGraphic />}
      title='No files yet'
      description='Drop files here to share them across your team and every agent.'
    />
  )
}
