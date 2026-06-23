import type { ComponentType, SVGProps } from 'react'
import { Search } from '@/components/emcn'
import { AnthropicIcon, GeminiIcon, OpenAIIcon, xAIIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'

/**
 * ModelPickerPreview — a static recreation of Sim's model selector, used as the
 * graphic inside the Execution card's {@link PlatformCorner} white block. It
 * showcases "mount any model / every major LLM": a search field over the model
 * list grouped by provider (Anthropic, OpenAI, Google, xAI) with real brand
 * icons, each model's context window on the right, and the recommended model
 * pre-selected.
 *
 * Model names and context windows mirror `apps/sim/providers/models.ts`. Purely
 * presentational — a corner of the product, so the lower providers dissolve
 * through the {@link PlatformCorner} corner fade, implying the rest of the
 * catalog.
 */
interface ModelEntry {
  name: string
  context: string
  selected?: boolean
}

interface ProviderGroup {
  name: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  models: ModelEntry[]
}

const PROVIDERS: ProviderGroup[] = [
  {
    name: 'Anthropic',
    Icon: AnthropicIcon,
    models: [
      { name: 'Claude Opus 4.8', context: '1M', selected: true },
      { name: 'Claude Sonnet 4.6', context: '1M' },
      { name: 'Claude Haiku 4.5', context: '200K' },
    ],
  },
  {
    name: 'OpenAI',
    Icon: OpenAIIcon,
    models: [
      { name: 'GPT-5.1', context: '400K' },
      { name: 'GPT-5', context: '400K' },
    ],
  },
  {
    name: 'Google',
    Icon: GeminiIcon,
    models: [
      { name: 'Gemini 3.1 Pro', context: '1M' },
      { name: 'Gemini 3.5 Flash', context: '1M' },
    ],
  },
  {
    name: 'xAI',
    Icon: xAIIcon,
    models: [{ name: 'Grok 4.3', context: '1M' }],
  },
]

export function ModelPickerPreview() {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-[40px] flex-shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
        <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='text-[var(--text-muted)] text-sm'>Search models…</span>
      </div>

      <div className='flex flex-col px-2 pt-1.5'>
        {PROVIDERS.map((provider) => (
          <div key={provider.name} className='flex flex-col'>
            <div className='flex items-center gap-1.5 px-2 pt-2 pb-1'>
              <provider.Icon className='size-[13px] flex-shrink-0' />
              <span className='text-[var(--text-muted)] text-caption'>{provider.name}</span>
            </div>
            {provider.models.map((model) => (
              <div
                key={model.name}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5',
                  model.selected && 'bg-[var(--surface-active)]'
                )}
              >
                <span className='text-[var(--text-body)] text-sm'>{model.name}</span>
                <span className='rounded bg-[var(--surface-5)] px-1 py-px text-[11px] text-[var(--text-muted)] leading-none'>
                  {model.context}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
