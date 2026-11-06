import styles from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access.module.css'
import {
  SCOPE_GROUPS,
  scopeGroup,
} from '@/platform/app/(shell)/integrations/_components/connection-access/scope-groups'
import { Icon, ScrollArea } from '@/platform/design-system/components'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'

interface ConnectionAccessProps {
  permissions: readonly { id: string; label: string; description?: string }[]
  title?: string
}

export function ConnectionAccess({
  permissions,
  title = 'Requested permissions',
}: ConnectionAccessProps) {
  if (!permissions.length) return null
  return (
    <section className={styles.section} aria-label={title}>
      <h2 data-type='T059'>
        <CountedLabel label={title} count={permissions.length} />
      </h2>
      <div className={styles.viewport}>
        <ScrollArea label={`${title} list`}>
          <div className={styles.groups}>
            {SCOPE_GROUPS.map((group) => {
              const items = permissions.filter(({ id }) => scopeGroup(id) === group)
              if (!items.length) return null
              return (
                <section className={styles.group} key={group} aria-label={group}>
                  <h3 data-type='T052'>{group}</h3>
                  <ul className={styles.items}>
                    {items.map(({ id, label, description }) => (
                      <li className={styles.item} key={id}>
                        <Icon name='I137' />
                        <span className={styles.copy}>
                          <span data-type='T060'>{label}</span>
                          {description && (
                            <span className={styles.description} data-type='T050'>
                              {description}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </ScrollArea>
      </div>
    </section>
  )
}
