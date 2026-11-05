import styles from '@/platform/app/(shell)/integrations/_components/fixtures/connection-access/connection-access.module.css'
import {
  SCOPE_GROUPS,
  scopeGroup,
} from '@/platform/app/(shell)/integrations/_components/fixtures/connection-access/scope-groups'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import type { OrganizationIntegration } from '@/platform/lib/integrations/fixture-model'

interface AccessGroupProps {
  title: string
  items: readonly { id: string; label: string }[]
}

function AccessGroup({ title, items }: AccessGroupProps) {
  if (!items.length) return null
  return (
    <div className={styles.group}>
      <h3 data-type='T059'>
        <CountedLabel label={title} count={items.length} />
      </h3>
      <ul className={styles.items} aria-label={title}>
        {items.map(({ id, label }) => (
          <li data-type='T060' key={id}>
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface ConnectionAccessProps {
  integration: OrganizationIntegration
}

export function ConnectionAccess({ integration }: ConnectionAccessProps) {
  const { searchReads, searchResource, requestedScopes, availability, accessDescription } =
    integration
  return (
    <>
      {searchResource &&
        availability === 'ready' &&
        (searchReads.length > 0 || !requestedScopes?.length) && (
          <section className={styles.section} aria-label='Search access'>
            <header className={styles.heading}>
              <h2 data-type='T093'>Search access</h2>
              <p data-type='T060'>{accessDescription}</p>
            </header>
            <AccessGroup title='Read-only tools' items={searchReads} />
          </section>
        )}
      {requestedScopes && requestedScopes.length > 0 && (
        <section className={styles.section} aria-label='Requested permissions'>
          <h2 data-type='T093'>Requested permissions</h2>
          {SCOPE_GROUPS.map((group) => (
            <AccessGroup
              key={group}
              title={group}
              items={requestedScopes.filter(({ id }) => scopeGroup(id) === group)}
            />
          ))}
        </section>
      )}
    </>
  )
}
