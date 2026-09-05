import { Chip } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

const BUILD_PAGES = ['Workflows', 'Agents', 'Knowledge Base'] as const

/** A compact reading view of the Docs getting-started guide and its structured output. */
export function DocsMenuPreview() {
  return (
    <MenuPreviewFrame kind='docs'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={BookOpen} title='Documentation' />
        <div className='flex min-h-[356px]'>
          <div className='w-[148px] shrink-0 border-[var(--border)] border-r px-2 py-3'>
            <p className='mb-1 px-2 text-[var(--text-muted)] text-caption'>Get started</p>
            <Chip className='w-full justify-start' tabIndex={-1}>
              Introduction
            </Chip>
            <Chip active className='w-full justify-start' tabIndex={-1}>
              Getting started
            </Chip>
            <p className='mt-4 mb-1 px-2 text-[var(--text-muted)] text-caption'>Build</p>
            {BUILD_PAGES.map((page) => (
              <Chip key={page} className='w-full justify-start' tabIndex={-1}>
                {page}
              </Chip>
            ))}
          </div>
          <div className='min-w-0 flex-1 p-4'>
            <p className='text-[24px] text-[var(--text-primary)] leading-7 tracking-[-0.6px]'>
              Getting started
            </p>
            <p className='mt-1.5 max-w-[340px] text-[var(--text-secondary)] leading-[18px]'>
              Build your first agent with search tools and structured output.
            </p>
            <p className='mt-6 text-[var(--text-primary)] text-small'>Structured output</p>
            <pre className='mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-3 font-mono text-[11px] text-[var(--text-secondary)] leading-5'>
              <code>
                {'{\n  "location": "San Francisco",\n  "profession": "Software engineer"\n}'}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
