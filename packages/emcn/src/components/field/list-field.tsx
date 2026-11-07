import { FieldFrame } from '#emcn/components/field/frame'
import styles from '#emcn/components/field/list-field.module.css'
import { ScrollArea } from '#emcn/components/scroll-area/scroll-area'

interface ListFieldProps {
  label: string
  groups: readonly {
    id: string
    label?: string
    items: readonly { id: string; label: string; description?: string }[]
  }[]
}

/** A bounded, read-only form list with optional groups and item descriptions. */
export function ListField({ label, groups }: ListFieldProps) {
  const count = groups.reduce((total, group) => total + group.items.length, 0)
  if (!count) return null
  return (
    <section aria-label={label}>
      <FieldFrame label={label} count={count}>
        <div className={styles.viewport}>
          <ScrollArea label={`${label} list`}>
            <div className={styles.groups}>
              {groups
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <section className={styles.group} key={group.id} aria-label={group.label}>
                    {group.label && <h3 data-type='T052'>{group.label}</h3>}
                    <ul className={styles.items}>
                      {group.items.map(({ id, label: itemLabel, description }) => (
                        <li className={styles.item} key={id} data-type='T060'>
                          <span className={styles.copy}>
                            <span>{itemLabel}</span>
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
                ))}
            </div>
          </ScrollArea>
        </div>
      </FieldFrame>
    </section>
  )
}
