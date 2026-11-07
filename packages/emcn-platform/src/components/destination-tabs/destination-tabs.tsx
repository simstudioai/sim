import { ControlRow } from '@sim/emcn/button/control-row'
import { ScrollArea } from '@sim/emcn/scroll-area'
import listStyles from '@sim/emcn/tabs/tab-list.shared.module.css'
import Link from 'next/link'
import styles from '#platform/components/destination-tabs/destination-tabs.module.css'

interface DestinationTabsProps {
  label: string
  destinations: readonly { label: string; href: string }[]
  currentHref: string
}

export function DestinationTabs({ label, destinations, currentHref }: DestinationTabsProps) {
  return (
    <nav aria-label={label} className={styles.destinations}>
      <ScrollArea label={label} axis='horizontal' arrows>
        <div className={listStyles.lane}>
          {destinations.map(({ label: text, href }) => (
            <ControlRow
              key={href}
              label={text}
              render={
                <Link
                  href={href}
                  scroll={false}
                  aria-current={href === currentHref ? 'page' : undefined}
                />
              }
            />
          ))}
        </div>
      </ScrollArea>
    </nav>
  )
}
