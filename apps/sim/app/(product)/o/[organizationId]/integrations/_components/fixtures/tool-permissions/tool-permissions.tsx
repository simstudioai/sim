'use client'

import { useState } from 'react'
import { ToolPermissions } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions'
import type {
  CredentialToolPermissions,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'
import type { ToolPermissionChange, ToolPolicy } from '@/platform/shared/integrations'

interface FixtureToolPermissionsProps {
  account: Pick<IntegrationCredential, 'status'>
  permissions: CredentialToolPermissions
  onChange: (next: CredentialToolPermissions) => void
  readOnly: boolean
}

/** Example tool policies, edited in the product session through the live permissions owner. */
export function FixtureToolPermissions({
  account,
  permissions,
  onChange,
  readOnly,
}: FixtureToolPermissionsProps) {
  const [query, setQuery] = useState('')
  const override = (kind: 'read' | 'write', policy: ToolPolicy | null) =>
    policy === permissions[kind] ? null : policy
  function apply(change: ToolPermissionChange) {
    if (change.kind === 'group')
      onChange({
        ...permissions,
        [change.effect]: change.policy,
        tools: permissions.tools.map((tool) =>
          tool.kind === change.effect ? { ...tool, override: null } : tool
        ),
      })
    else
      onChange({
        ...permissions,
        tools: permissions.tools.map((tool) =>
          tool.id === change.toolId
            ? { ...tool, override: override(tool.kind, change.policy) }
            : tool
        ),
      })
  }
  return (
    <ToolPermissions
      permissions={{
        read: permissions.read,
        write: permissions.write,
        canAutoApprove: permissions.canAutoApprove,
        accountActive: account.status === 'active',
        tools: permissions.tools.map((tool) => ({
          id: tool.id,
          label: tool.label,
          description: tool.description ?? '',
          kind: tool.kind,
          policy: tool.override ?? permissions[tool.kind],
          inherited: tool.override === null,
        })),
      }}
      query={query}
      onQueryChange={setQuery}
      pending={readOnly}
      onChange={apply}
    />
  )
}
