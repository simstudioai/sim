import {
  SCOPE_GROUPS,
  scopeGroup,
} from '@/platform/app/(shell)/integrations/_components/connection-access/scope-groups'
import { ListField } from '@/platform/design-system/components'

interface ConnectionAccessProps {
  permissions: readonly { id: string; label: string; description?: string }[]
  title?: string
}

export function ConnectionAccess({
  permissions,
  title = 'Requested permissions',
}: ConnectionAccessProps) {
  return (
    <ListField
      label={title}
      groups={SCOPE_GROUPS.map((group) => ({
        id: group,
        label: group,
        items: permissions.filter(({ id }) => scopeGroup(id) === group),
      }))}
    />
  )
}
