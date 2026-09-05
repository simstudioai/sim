import { BrainCircuit, Search } from '@sim/emcn/icons'
import { AnthropicIcon, GeminiIcon, OpenAIIcon } from '@/components/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

const MODELS = [
  { name: 'GPT-6 Astra', provider: 'OpenAI', icon: OpenAIIcon },
  { name: 'Claude Sonnet 5', provider: 'Anthropic', icon: AnthropicIcon },
  { name: 'Gemini 3.6 Flash', provider: 'Google', icon: GeminiIcon },
] as const

/** A quiet model directory extending past the preview's right and bottom edges. */
export function ModelsMenuPreview() {
  return (
    <MenuPreviewFrame kind='models'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={BrainCircuit} title='Models' />
        <MenuPreviewToolbar>
          <span className='ml-2 flex items-center gap-2 text-[var(--text-muted)]'>
            <Search className='size-[14px]' />
            Search models...
          </span>
        </MenuPreviewToolbar>
        <div className='divide-y divide-[var(--border)]'>
          {MODELS.map(({ name, provider, icon: Icon }) => (
            <div key={name} className='flex h-[76px] items-center gap-3 px-4'>
              <Icon className='size-7 shrink-0 text-[var(--text-primary)]' />
              <div>
                <p className='text-[var(--text-primary)] text-base'>{name}</p>
                <p className='mt-1 text-[var(--text-muted)]'>{provider}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
