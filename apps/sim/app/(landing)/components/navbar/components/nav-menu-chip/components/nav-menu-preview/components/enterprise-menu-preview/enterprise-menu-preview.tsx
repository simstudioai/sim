import { Chip, ChipDropdown, cn } from '@sim/emcn'
import { Building, MoreHorizontal, Plus } from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { MemberRow } from '@/app/workspace/[workspaceId]/settings/components/member-list/member-list'
import { SegmentedMeter } from '@/app/workspace/[workspaceId]/settings/components/segmented-meter/segmented-meter'

const MEMBERS = [
  { name: 'Morgan', email: 'morgan@example.com', role: 'Owner' },
  { name: 'Alex', email: 'alex@example.com', role: 'Admin' },
  { name: 'Jamie', email: 'jamie@example.com', role: 'Member' },
] as const

interface EnterpriseMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

/** Production member rows, role chips, and allowance meter make organization controls tangible. */
export function EnterpriseMenuPreview({ layout = 'menu' }: EnterpriseMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind='enterprise' layout={layout}>
      <div
        className={cn(
          'w-[566px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] shadow-xs',
          layout === 'hero' && '@max-[640px]:w-[calc(100cqw-48px)] min-w-[340px]'
        )}
      >
        <MenuPreviewHeader
          icon={Building}
          title='Organization'
          actions={
            <>
              <Chip active>Members</Chip>
              <Chip variant='outline' leftIcon={Plus}>
                Invite
              </Chip>
            </>
          }
        />
        <div className='px-4 pt-4 pb-5'>
          <div className='-mx-2 flex flex-col gap-1'>
            {MEMBERS.map((member) => (
              <MemberRow
                key={member.name}
                name={member.name}
                email={member.email}
                image={null}
                status=''
                roleControl={
                  <ChipDropdown
                    value={member.role}
                    options={[{ value: member.role, label: member.role }]}
                    disabled={member.role === 'Owner'}
                    matchTriggerWidth={false}
                  />
                }
                menu={<MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />}
              />
            ))}
          </div>
          <div className='mt-4 border-[var(--border)] border-t pt-4'>
            <div className='mb-3 flex items-center justify-between text-[13px]'>
              <span className='text-[var(--text-body)]'>Workspace usage</span>
              <span className='text-[var(--text-muted)] tabular-nums'>$1,240 of $2,000</span>
            </div>
            <SegmentedMeter used={1240} total={2000} segments={28} />
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
