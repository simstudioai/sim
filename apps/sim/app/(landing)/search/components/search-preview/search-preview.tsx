'use client'

import { cn } from '@sim/emcn'
import dynamic from 'next/dynamic'
import { FilesMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/files-menu-preview'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { useLazyMount } from '@/app/(landing)/hooks/use-lazy-mount'
import { SearchBackdrop } from '@/app/(landing)/search/components/search-backdrop/search-backdrop'

const SearchChatLoop = dynamic(
  () =>
    import('@/app/(landing)/search/components/search-chat-loop/search-chat-loop').then(
      (module) => module.SearchChatLoop
    ),
  { ssr: false }
)

interface SearchPreviewProps {
  layout?: 'menu' | 'hero' | 'feature'
  mode?: 'chat' | 'files' | 'context'
}

/** The platform's Chat and Files surfaces, framed by the shared progressive edge blur. */
export function SearchPreview({ layout = 'menu', mode = 'chat' }: SearchPreviewProps) {
  const { ref, inView } = useLazyMount('0px')
  const menu = layout === 'menu'

  if (layout === 'feature' && mode === 'files') {
    return <FilesMenuPreview layout='feature' />
  }

  return (
    <div
      ref={ref}
      aria-hidden='true'
      className={cn(
        'pointer-events-none relative isolate overflow-hidden',
        layout === 'hero' ? 'h-[360px] max-sm:h-[400px]' : 'size-full min-h-[340px]'
      )}
    >
      {layout === 'hero' && <SearchBackdrop />}
      <div
        className={cn(
          'absolute inset-x-0 mx-auto h-full max-w-[760px]',
          layout === 'feature' && 'top-10 h-[400px] max-sm:top-4'
        )}
      >
        {inView && (
          <SearchChatLoop
            initialScenario={mode === 'files' ? 1 : mode === 'context' ? 2 : 0}
            presentation={layout === 'feature' ? 'conversation' : 'search'}
          />
        )}
      </div>
      <EdgeFade ground={menu ? 'surface' : 'canvas'} edges={['bottom']} depth='preview' />
    </div>
  )
}
