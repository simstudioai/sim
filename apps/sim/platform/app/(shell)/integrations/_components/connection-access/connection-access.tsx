import styles from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access.module.css'
import { Disclosure } from '@/platform/design-system/components'
import type { OrganizationIntegration } from '@/platform/lib/integrations/model'

interface ConnectionAccessProps {
  integration: OrganizationIntegration
}

export function ConnectionAccess({ integration }: ConnectionAccessProps) {
  const scopes = integration.requestedScopes
  if (!scopes?.length) return null
  return (
    <Disclosure label='Requested permissions' variant='activity'>
      <ul className={styles.scopes} aria-label='Requested provider permissions'>
        {scopes.map(({ id, label }) => (
          <li key={id} className={styles.scope}>
            <span data-type='T059'>{label}</span>
            {label !== id && <span data-type='T050'>{id}</span>}
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
