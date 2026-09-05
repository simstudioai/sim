import { Library } from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

const GUIDES = [
  { title: 'How to Build AI Agents With Sim', category: 'How-to' },
  { title: 'AI Agent vs Chatbot: Understanding the Differences', category: 'Comparison' },
  { title: 'How to Turn a Workflow Into a Reusable MCP Tool', category: 'How-to' },
  { title: '10 AI Agent Ideas for Real Impact', category: 'Ideas' },
] as const

/** A minimal grid of published guides whose lower row continues beyond the preview crop. */
export function LibraryMenuPreview() {
  return (
    <MenuPreviewFrame kind='library'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={Library} title='Library' />
        <div className='grid grid-cols-2 gap-3 p-4'>
          {GUIDES.map(({ title, category }) => (
            <div
              key={title}
              className='h-[140px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4'
            >
              <p className='text-[var(--text-muted)] text-small'>{category}</p>
              <p className='mt-4 max-w-[230px] text-[var(--text-primary)] text-base leading-5'>
                {title}
              </p>
            </div>
          ))}
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
