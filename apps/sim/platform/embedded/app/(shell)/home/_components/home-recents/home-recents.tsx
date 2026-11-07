'use client'

import { RecentItems } from '@sim/emcn-platform/recent-items'
import { SiteMark } from '@/platform/embedded/app/(shell)/_components/site-mark/site-mark'
import type { HomeRecentItem } from '@/platform/embedded/lib/data/home-view'

interface HomeRecentsProps {
  items: readonly HomeRecentItem[]
  onRemove: (id: string) => void
}

export function HomeRecents({ items, onRemove }: HomeRecentsProps) {
  return (
    <RecentItems
      label='Recents'
      items={items.map((item) => ({
        ...item,
        leading: item.icon ? undefined : <SiteMark key={item.host} host={item.host} />,
      }))}
      onRemove={onRemove}
    />
  )
}
