'use client'

import { SiteMark } from '@/platform/app/(shell)/_components/site-mark/site-mark'
import styles from '@/platform/app/(shell)/home/_components/home-recents/home-recents.module.css'
import { IconButton } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { RecentItems } from '@/platform/design-system/components/recent-items/recent-items'
import type { HomeRecentItem } from '@/platform/lib/data/home-view'

interface HomeRecentsProps {
  items: readonly HomeRecentItem[]
  onRemove: (id: string) => void
  offer: boolean
  onOpenSetup: () => void
  onDismissOffer: () => void
}

/**
 * Pages from this browser's history are the person's own: `ph-no-capture` keeps them out of
 * analytics and replay, and they have no remove, because the server never held them.
 */
export function HomeRecents({
  items,
  onRemove,
  offer,
  onOpenSetup,
  onDismissOffer,
}: HomeRecentsProps) {
  const local = items.some((item) => item.local)
  return (
    <div className={local ? `${styles.recents} ph-no-capture` : styles.recents}>
      {items.length > 0 && (
        <RecentItems
          label='Recents'
          items={items.map((item) => ({
            ...item,
            leading: item.icon ? undefined : (
              <SiteMark key={item.id} host={item.host} iconUrl={item.iconUrl} />
            ),
          }))}
          onRemove={local ? undefined : onRemove}
        />
      )}
      {offer && (
        <div className={styles.offer}>
          <ControlRow
            label='See your recently visited pages here'
            icon='I041'
            actionSide='start'
            render={<button type='button' onClick={onOpenSetup} />}
            action={
              <IconButton
                icon='I105'
                size='compact'
                label='Dismiss recently visited pages'
                onClick={onDismissOffer}
              />
            }
          />
        </div>
      )}
    </div>
  )
}
