'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/integration-catalog/integration-catalog.module.css'
import { IntegrationSetup } from '@/platform/app/(shell)/integrations/_components/integration-catalog/integration-setup'
import {
  ActivityRow,
  EmptyState,
  ModalBody,
  SearchField,
} from '@/platform/design-system/components'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import type { IntegrationDraft, IntegrationProvider } from '@/platform/lib/integrations/model'

interface IntegrationCatalogProps {
  providers: readonly IntegrationProvider[]
  installedIds: readonly string[]
  onAdd: (draft: IntegrationDraft) => void
  onClose: () => void
}

export function IntegrationCatalog({
  providers,
  installedIds,
  onAdd,
  onClose,
}: IntegrationCatalogProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<IntegrationProvider | null>(null)
  const scroll = useScrollEdges<HTMLUListElement>('vertical', { tabStop: true })
  const available = providers.filter((provider) => !installedIds.includes(provider.id))
  const term = query.trim().toLowerCase()
  const matches = available.filter((provider) =>
    `${provider.name} ${provider.description}`.toLowerCase().includes(term)
  )

  if (selected) {
    return <IntegrationSetup provider={selected} onCancel={() => setSelected(null)} onAdd={onAdd} />
  }
  return (
    <OverlayDialog title='Add integration' open onClose={onClose}>
      <ModalBody label='Available integrations'>
        {available.length > 0 && (
          <SearchField
            label='Search integrations'
            placeholder='Search integrations…'
            defaultValue={query}
            onValueChange={setQuery}
          />
        )}
        {matches.length ? (
          <ul ref={scroll} className={styles.providers} aria-label='Available integrations'>
            {matches.map((provider) => (
              <ActivityRow
                key={provider.id}
                title={provider.name}
                detail={provider.description}
                leading={<Icon providerId={provider.id} />}
                onOpen={() => setSelected(provider)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title={available.length ? 'No matching integrations' : 'No integrations to add'}
          />
        )}
      </ModalBody>
    </OverlayDialog>
  )
}
