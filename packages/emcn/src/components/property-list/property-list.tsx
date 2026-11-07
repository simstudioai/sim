import { useId } from 'react'
import Link from 'next/link'
import { Avatar } from '#emcn/components/avatar/avatar'
import styles from '#emcn/components/property-list/property-list.module.css'

export type PropertyItem = { id: string; label: string } & (
  | { kind: 'text' | 'metadata'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'person'; value: string; src?: string }
)

interface PropertyListProps {
  title: string
  /** Name the list for assistive technology only, where its section already titles it. */
  titleHidden?: boolean
  properties: readonly PropertyItem[]
}

export function PropertyList({ title, titleHidden, properties }: PropertyListProps) {
  const heading = useId()
  return (
    <section aria-labelledby={heading} className={styles.list}>
      <h2 id={heading} data-type='T042' data-visually-hidden={titleHidden || undefined}>
        {title}
      </h2>
      <dl className={styles.rows}>
        {properties.map((property) => (
          <div className={styles.row} key={property.id}>
            <dt data-type='T050'>{property.label}</dt>
            <dd data-type='T060' data-kind={property.kind}>
              {property.kind === 'person' && (
                <Avatar name={property.value} src={property.src} size='inline' />
              )}
              {property.kind === 'link' ? (
                <Link href={property.href}>{property.value}</Link>
              ) : (
                <span>{property.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
