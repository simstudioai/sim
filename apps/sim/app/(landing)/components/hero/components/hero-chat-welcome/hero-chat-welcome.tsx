import { cn } from '@sim/emcn'
import { ArrowRight, FileText, Table, Workflow } from '@sim/emcn/icons'
import { PREVIEW_SUGGESTIONS } from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-chat-content'

interface HeroChatWelcomeProps {
  visible: boolean
  onSelect: (prompt: string) => void
}

const ACTION_ICONS = [Workflow, Table, FileText] as const
const REVEAL = 'transition-opacity duration-150 ease-out motion-reduce:transition-none'

/** Greeting and suggested actions anchored around the preview's single composer. */
export function HeroChatWelcome({ visible, onSelect }: HeroChatWelcomeProps) {
  return (
    <>
      <p
        data-preview-skeleton-label=''
        aria-hidden={!visible}
        className={cn(
          'absolute inset-x-0 bottom-[calc(100%+28px)] text-balance text-center text-[26px] text-[var(--text-primary)] leading-[1.2] tracking-[-0.01em] max-sm:bottom-[calc(100%+20px)] max-sm:text-[20px]',
          REVEAL,
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        What should we get done, Morgan?
      </p>
      <div
        inert={!visible}
        aria-hidden={!visible}
        className={cn(
          'absolute inset-x-0 top-[calc(100%+28px)] max-sm:hidden',
          REVEAL,
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <span data-preview-skeleton-label='' className='text-[13px] text-[var(--text-secondary)]'>
          Suggested actions
        </span>
        <div className='mt-2 flex flex-col'>
          {PREVIEW_SUGGESTIONS.map((action, index) => {
            const Icon = ACTION_ICONS[index]
            return (
              <button
                key={action.title}
                type='button'
                onClick={() => onSelect(action.prompt)}
                className='flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left text-[var(--text-body)] text-sm transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] [&+button]:border-t'
              >
                <Icon className='size-[16px] shrink-0 text-[var(--text-icon)]' />
                <span data-preview-skeleton-label='' className='min-w-0 flex-1 truncate'>
                  {action.title}
                </span>
                <ArrowRight className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
