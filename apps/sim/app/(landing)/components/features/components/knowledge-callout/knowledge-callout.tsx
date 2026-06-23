import { Database, File } from '@/components/emcn'
import { CalloutFrame } from '@/app/(landing)/components/features/components/feature-stage/feature-stage'

/**
 * The Ingest-context beat's callout — a static recreation of a Sim knowledge
 * base: uploaded docs and synced sources, chunked and embedded so agents can
 * read them semantically. The chunk counts stand in for the vector index; the
 * lower rows dissolve through the frame's foot fade. Decorative.
 */
interface Source {
  name: string
  meta: string
}

const SOURCES: Source[] = [
  { name: 'Product docs', meta: '128 chunks' },
  { name: 'Sales playbook.pdf', meta: '64 chunks' },
  { name: 'Support macros', meta: '212 chunks' },
  { name: 'Engineering — Notion', meta: 'Synced' },
  { name: 'Pricing & plans', meta: '18 chunks' },
  { name: 'Onboarding guide', meta: '47 chunks' },
]

export function KnowledgeCallout() {
  return (
    <CalloutFrame className='w-[360px]' bodyClassName='h-[300px]' fade>
      <div className='flex h-full flex-col'>
        <div className='flex h-[44px] flex-shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
          <Database className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='font-medium text-[var(--text-body)] text-sm'>Knowledge base</span>
          <span className='ml-auto text-[11px] text-[var(--text-muted)]'>6 sources · embedded</span>
        </div>
        <div className='flex flex-col px-2 pt-1.5'>
          {SOURCES.map(({ name, meta }) => (
            <div key={name} className='flex items-center gap-2.5 rounded-md px-2 py-2'>
              <File className='size-[15px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='flex-1 truncate text-[var(--text-body)] text-sm'>{name}</span>
              <span className='flex-shrink-0 text-[11px] text-[var(--text-muted)]'>{meta}</span>
            </div>
          ))}
        </div>
      </div>
    </CalloutFrame>
  )
}
