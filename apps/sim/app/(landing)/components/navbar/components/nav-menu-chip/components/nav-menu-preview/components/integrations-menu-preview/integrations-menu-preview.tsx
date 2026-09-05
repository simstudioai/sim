import { Integration, Search } from '@sim/emcn/icons'
import {
  GithubIcon,
  GmailIcon,
  GoogleDriveIcon,
  LinearIcon,
  NotionIcon,
  SlackIcon,
} from '@/components/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

const INTEGRATIONS = [
  { name: 'Slack', icon: SlackIcon },
  { name: 'Notion', icon: NotionIcon },
  { name: 'Google Drive', icon: GoogleDriveIcon },
  { name: 'GitHub', icon: GithubIcon },
  { name: 'Gmail', icon: GmailIcon },
  { name: 'Linear', icon: LinearIcon },
] as const

/** Minimal app tiles in a native directory crop that continues beyond the preview edges. */
export function IntegrationsMenuPreview() {
  return (
    <MenuPreviewFrame kind='integrations'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={Integration} title='Integrations' />
        <MenuPreviewToolbar>
          <span className='ml-2 flex items-center gap-2 text-[var(--text-muted)]'>
            <Search className='size-[14px]' />
            Search integrations...
          </span>
        </MenuPreviewToolbar>
        <div className='grid grid-cols-3 gap-3 p-4'>
          {INTEGRATIONS.map(({ name, icon: Icon }) => (
            <div
              key={name}
              className='flex h-[114px] min-w-0 flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'
            >
              <Icon className='size-7' />
              <div className='text-[var(--text-primary)] text-base'>{name}</div>
            </div>
          ))}
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
