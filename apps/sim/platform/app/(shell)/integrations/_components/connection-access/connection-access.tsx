'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access.module.css'
import {
  SCOPE_GROUPS,
  scopeGroup,
} from '@/platform/app/(shell)/integrations/_components/connection-access/scope-groups'
import { Button, Disclosure } from '@/platform/design-system/components'
import type { OrganizationIntegration } from '@/platform/lib/integrations/model'

interface ConnectionAccessProps {
  integration: OrganizationIntegration
}

export function ConnectionAccess({ integration }: ConnectionAccessProps) {
  const [showIds, setShowIds] = useState(false)
  const scopes = integration.requestedScopes
  if (!scopes?.length) return null
  return (
    <section className={styles.section} aria-label='Requested permissions'>
      <header className={styles.header}>
        <h2 data-type='T093'>Requested permissions</h2>
        <Button
          size='compact'
          variant='quiet'
          render={<button type='button' aria-expanded={showIds} />}
          onClick={() => setShowIds(!showIds)}
        >
          {showIds ? 'Hide scope IDs' : 'Show scope IDs'}
        </Button>
      </header>
      {SCOPE_GROUPS.map((group) => {
        const entries = scopes.filter(({ id }) => scopeGroup(id) === group)
        if (!entries.length) return null
        return (
          <Disclosure key={group} label={group} initiallyOpen>
            <ul className={styles.scopes} aria-label={group}>
              {entries.map(({ id, label }) => (
                <li key={id} className={styles.scope}>
                  <span data-type='T060'>{label}</span>
                  {showIds && label !== id && <span data-type='T050'>{id}</span>}
                </li>
              ))}
            </ul>
          </Disclosure>
        )
      })}
    </section>
  )
}
