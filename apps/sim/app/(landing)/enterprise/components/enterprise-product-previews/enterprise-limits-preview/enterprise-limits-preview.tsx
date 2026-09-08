import { ChipInput } from '@sim/emcn'
import { Building } from '@sim/emcn/icons'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { SegmentedMeter } from '@/app/workspace/[workspaceId]/settings/components/segmented-meter/segmented-meter'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

/** The Enterprise seat allowance and usage-limit field use the settings page's own primitives. */
export function EnterpriseLimitsPreview() {
  return (
    <div className='absolute top-16 right-[12%] bottom-[-40px] left-[12%] min-w-[360px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]'>
      <MenuPreviewHeader icon={Building} title='Organization' />
      <div className='flex flex-col gap-6 px-4 py-4'>
        <SettingsSection label='Seats'>
          <div className='flex flex-col gap-2.5'>
            <span className='text-[var(--text-body)] text-small tabular-nums'>
              18 used / 25 total
            </span>
            <SegmentedMeter used={18} total={25} segments={25} />
            <p className='text-[var(--text-muted)] text-small'>
              Contact support for enterprise seat changes.
            </p>
          </div>
        </SettingsSection>
        <SettingsSection label='Usage limit'>
          <ChipInput aria-label='Example monthly credit limit' value='200000' readOnly />
        </SettingsSection>
      </div>
    </div>
  )
}
