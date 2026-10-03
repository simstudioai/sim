'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { SourceIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip/source-icon'
import { useSourceNavigation } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { PROSE_LINK_CLASS } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import { SourcePreview } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-preview'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/** Retrieved metadata takes precedence over generic public-page metadata. */
export const LinkSourcesContext = createContext<ReadonlyMap<string, SourceTagData>>(new Map())

interface ExternalLinkProps {
  href: string
  children?: ReactNode
}

/** The anchor stays inline so long link text wraps with the surrounding prose. */
export function ExternalLink({ href, children }: ExternalLinkProps) {
  const source = useContext(LinkSourcesContext).get(href) ?? { url: href }
  const navigate = useSourceNavigation(source)
  return (
    <SourcePreview key={source.url} source={source}>
      <a
        href={href}
        className={PROSE_LINK_CLASS}
        target='_blank'
        rel='noopener noreferrer'
        onClick={navigate}
        onAuxClick={navigate}
      >
        <span aria-hidden className='mr-1 inline-flex items-center align-middle'>
          <SourceIcon source={source} />
        </span>
        {children}
      </a>
    </SourcePreview>
  )
}
