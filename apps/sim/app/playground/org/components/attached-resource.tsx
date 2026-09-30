'use client'

import { ChipTag } from '@sim/emcn'
import { type PanelResource, panelKindConfig } from '@/app/playground/org/lib/chat-resources'

/** A resource attached to the message being written, as the real composer shows dropped context. */
export function AttachedResource({ resource }: { resource: PanelResource }) {
  const Icon = panelKindConfig(resource.kind).icon
  return (
    <ChipTag variant='gray'>
      <Icon className='size-[12px] text-[var(--text-icon)]' />
      {resource.name}
    </ChipTag>
  )
}
