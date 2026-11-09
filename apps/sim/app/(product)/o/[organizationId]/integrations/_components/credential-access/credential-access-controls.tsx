import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/credential-access/credential-access.module.css'
import type { CredentialAccessView } from '@/platform/lib/integrations/credential-navigation'

interface CredentialAccessSearchProps {
  value: string
  onChange: (value: string) => void
}

export function CredentialAccessSearch({ value, onChange }: CredentialAccessSearchProps) {
  return (
    <div className={styles.search}>
      <SearchField
        variant='quiet'
        label='Search people'
        placeholder='Search people…'
        value={value}
        onValueChange={onChange}
      />
    </div>
  )
}

interface CredentialAccessControlsProps {
  view: CredentialAccessView
  onRoleChange: (value: CredentialAccessView['accessRole']) => void
  onOrderChange: (value: CredentialAccessView['accessOrder']) => void
}

export function CredentialAccessControls({
  view,
  onRoleChange,
  onOrderChange,
}: CredentialAccessControlsProps) {
  return (
    <div className={styles.tools}>
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
    </div>
  )
}
