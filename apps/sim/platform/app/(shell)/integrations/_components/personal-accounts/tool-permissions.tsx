import { useState } from 'react'
import { FieldFrame, Modal, Select } from '@/platform/design-system/components'
import type { IntegrationAccount, ToolPolicy } from '@/platform/lib/integrations/model'

type Permissions = NonNullable<IntegrationAccount['permissions']>
type ToolKind = Permissions['tools'][number]['kind']

const POLICIES = [
  { value: 'ask', label: 'Ask first' },
  { value: 'allow', label: 'Allow automatically' },
  { value: 'block', label: 'Block' },
] as const

interface ToolPermissionsProps {
  account: IntegrationAccount
  permissions: Permissions
  onSave: (next: Permissions) => void
  onClose: () => void
}

export function ToolPermissions({ account, permissions, onSave, onClose }: ToolPermissionsProps) {
  const [draft, setDraft] = useState(permissions)
  const canAllow = account.status === 'active' && permissions.canAutoApprove
  const policies = POLICIES.filter((policy) => policy.value !== 'allow' || canAllow)
  const effective = (value: ToolPolicy) => (value === 'allow' && !canAllow ? 'ask' : value)

  function changeDefault(kind: ToolKind, policy: ToolPolicy) {
    setDraft((current) => ({
      ...current,
      [kind]: policy === 'allow' ? 'ask' : policy,
      tools: current.tools.map((tool) =>
        tool.kind === kind ? { ...tool, override: policy === 'allow' ? policy : null } : tool
      ),
    }))
  }

  return (
    <Modal
      open
      onOpenChange={onClose}
      title='Tool permissions'
      description={account.label}
      confirmLabel='Save changes'
      onConfirm={() => onSave(draft)}
    >
      {!canAllow && (
        <p data-type='T060'>
          {account.status === 'needs_reauth'
            ? 'Reconnect this account to allow tools automatically.'
            : 'Your organization requires approval before tools can run.'}
        </p>
      )}
      {(['read', 'write'] as const).map((kind) => {
        const tools = draft.tools.filter((tool) => tool.kind === kind)
        if (!tools.length) return null
        const label = kind === 'read' ? 'Read tools' : 'Write tools'
        const allAllowed = tools.every((tool) => tool.override === 'allow')
        return (
          <FieldFrame key={kind} label={label}>
            <Select
              label={label}
              value={effective(allAllowed ? 'allow' : draft[kind])}
              options={policies}
              onValueChange={(value) => {
                const selected = policies.find((policy) => policy.value === value)
                if (selected) changeDefault(kind, selected.value)
              }}
            />
          </FieldFrame>
        )
      })}
      {draft.tools.map((tool) => {
        const inherited = POLICIES.find((policy) => policy.value === effective(draft[tool.kind]))
        return (
          <FieldFrame key={tool.id} label={tool.label}>
            <Select
              label={tool.label}
              options={[
                { value: 'inherit', label: `Use default (${inherited?.label})` },
                ...policies,
              ]}
              value={tool.override ? effective(tool.override) : 'inherit'}
              onValueChange={(value) => {
                const override = policies.find((policy) => policy.value === value)?.value ?? null
                setDraft((current) => ({
                  ...current,
                  tools: current.tools.map((entry) =>
                    entry.id === tool.id ? { ...entry, override } : entry
                  ),
                }))
              }}
            />
          </FieldFrame>
        )
      })}
    </Modal>
  )
}
