import { Calendar } from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

/** Release dates and summaries come from the checked-in release announcements. */
const RELEASES = [
  {
    date: 'Mar 17',
    year: '2026',
    title: 'Your agents, in one workspace',
    description: 'One workspace for your agents, data, and tools.',
  },
  {
    date: 'Jan 22',
    year: '2026',
    title: 'Copilot & MCP deployment',
    description: 'Build with context. Deploy any workflow as a tool.',
  },
] as const

/** An open release timeline with quiet separators and content extending past the cropped window. */
export function ChangelogMenuPreview() {
  return (
    <MenuPreviewFrame kind='changelog'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={Calendar} title='Changelog' />
        <div className='relative p-4'>
          <div className='absolute top-10 bottom-0 left-[91px] w-px bg-[var(--border)]' />
          {RELEASES.map(({ date, year, title, description }) => (
            <div key={title} className='relative grid min-h-36 grid-cols-[64px_1fr] gap-6'>
              <div className='pt-4 text-[var(--text-muted)] text-small'>
                <div className='text-[var(--text-secondary)]'>{date}</div>
                <div className='mt-0.5'>{year}</div>
              </div>
              <span className='absolute top-[22px] left-[72px] size-[7px] rounded-full border border-[var(--text-icon)] bg-[var(--bg)]' />
              <div className='border-[var(--border)] border-b pt-4 pb-8'>
                <div className='text-[var(--text-primary)] text-base'>{title}</div>
                <p className='mt-2 max-w-[350px] text-[var(--text-muted)] leading-relaxed'>
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
