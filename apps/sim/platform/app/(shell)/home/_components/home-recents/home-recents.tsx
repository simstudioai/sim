'use client'

import { SiteMark } from '@/platform/app/(shell)/_components/site-mark/site-mark'
import { RecentItems } from '@/platform/design-system/components/recent-items/recent-items'
import type { HomeRecentItem } from '@/platform/lib/data/home-view'

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
