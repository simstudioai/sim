import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/credential-access/credential-access.module.css'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { ActionMenu, ChoiceMenu, SearchField } from '@/platform/design-system/components'
import type { CredentialAccessView } from '@/platform/lib/integrations/credential-navigation'

interface CredentialAccessControlsProps {
  view: CredentialAccessView
  onSearch: (value: string) => void
  onRoleChange: (value: CredentialAccessView['accessRole']) => void
  onOrderChange: (value: CredentialAccessView['accessOrder']) => void
  children?: ReactNode
}

export function CredentialAccessControls({
  view,
  onSearch,
  onRoleChange,
  onOrderChange,
  children,
}: CredentialAccessControlsProps) {
  return (
    <div className={styles.tools}>
      <IntegrationControls
        leading={
          <SearchField
            variant='quiet'
            label='Search people'
            placeholder='Search people…'
            value={view.accessQ}
            onValueChange={onSearch}
          />
        }
      >
        <ChoiceMenu
          label='Role filter'
          value={view.accessRole}
          options={[
            { value: 'all', label: 'All roles' },
            { value: 'admin', label: 'Admin' },
            { value: 'member', label: 'Member' },
            { value: 'organization-admin', label: 'Organization admin' },
            { value: 'workspace-admin', label: 'Workspace admin' },
          ]}
          onValueChange={(value) => {
            if (
              value === 'all' ||
              value === 'admin' ||
              value === 'member' ||
              value === 'organization-admin' ||
              value === 'workspace-admin'
            )
              onRoleChange(value)
          }}
        />
        <ActionMenu
          label='Sort people'
          icon='I050'
          actions={[
            {
              id: 'asc',
              label: 'Name A–Z',
              checked: view.accessOrder === 'asc',
              onSelect: () => onOrderChange('asc'),
            },
            {
              id: 'desc',
              label: 'Name Z–A',
              checked: view.accessOrder === 'desc',
              onSelect: () => onOrderChange('desc'),
            },
          ]}
        />
      </IntegrationControls>
      {children}
    </div>
  )
}
