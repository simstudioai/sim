'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions.module.css'
import {
  Button,
  EmptyState,
  SearchField,
  SegmentedControl,
} from '@/platform/design-system/components'
import { ChoiceMenu } from '@/platform/design-system/components/menu/choice-menu'
import type { IntegrationAccount, ToolPolicy } from '@/platform/lib/integrations/model'

type Permissions = NonNullable<IntegrationAccount['permissions']>
type Effect = Permissions['tools'][number]['kind']

const ACTIONS = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
] as const
const GROUPS = [
  { kind: 'read', label: 'Read tools' },
  { kind: 'write', label: 'Write tools' },
] as const

interface ToolPermissionsProps {
  account: IntegrationAccount
  permissions: Permissions
  onChange: (next: Permissions) => void
}

export function ToolPermissions({ account, permissions, onChange }: ToolPermissionsProps) {
  const [query, setQuery] = useState('')
  const canAllow = permissions.canAutoApprove && account.status === 'active'
  const choices = ACTIONS.map((option) => ({
    ...option,
    disabled: option.value === 'allow' && !canAllow,
  }))
  const filter = query.trim().toLowerCase()
  const matches = permissions.tools.filter((tool) =>
    `${tool.label} ${tool.description ?? ''}`.toLowerCase().includes(filter)
  )

  function updateGroup(kind: Effect, policy: ToolPolicy) {
    onChange({
      ...permissions,
      [kind]: policy === 'allow' ? 'ask' : policy,
      tools: permissions.tools.map((tool) =>
        kind === tool.kind ? { ...tool, override: policy === 'allow' ? 'allow' : null } : tool
      ),
    })
  }

  function updateTool(id: string, override: ToolPolicy | null) {
    onChange({
      ...permissions,
      tools: permissions.tools.map((tool) => (tool.id === id ? { ...tool, override } : tool)),
    })
  }

  return (
    <section className={styles.section} aria-label='Tool permissions'>
      <div className={styles.intro}>
        <h2 data-type='T093'>Tool permissions</h2>
        {!canAllow && (
          <p className={styles.detail} data-type='T060'>
            {account.status === 'needs_reauth'
              ? 'Reconnect this account to allow tools automatically.'
              : 'Your organization requires approval before tools can run.'}
          </p>
        )}
      </div>
      <SearchField label='Search tools' placeholder='Search tools…' onValueChange={setQuery} />
      {GROUPS.map(({ kind, label }) => {
        const matching = matches.filter((tool) => tool.kind === kind)
        if (!matching.length) return null
        const tools = permissions.tools.filter((item) => item.kind === kind)
        const first = tools[0].override ?? permissions[kind]
        const group = tools.every((item) => (item.override ?? permissions[kind]) === first)
          ? first
          : null
        return (
          <section key={kind} className={styles.group} aria-label={label}>
            <div className={styles.groupTitle}>
              <h3 data-type='T059'>
                {label} ({tools.length})
              </h3>
              <ChoiceMenu
                label={`${label} permission`}
                placeholder='Mixed'
                value={group}
                options={choices}
                onValueChange={(policy) => updateGroup(kind, policy)}
              />
            </div>
            <ul className={styles.list}>
              {matching.map((tool) => (
                <li className={styles.tool} key={tool.id}>
                  <div className={styles.copy}>
                    <span data-type='T059'>{tool.label}</span>
                    {tool.description && (
                      <span className={styles.detail} data-type='T060'>
                        {tool.description}
                      </span>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {tool.override && (
                      <Button
                        size='compact'
                        variant='quiet'
                        render={<button aria-label={`Use default for ${tool.label}`} />}
                        onClick={() => updateTool(tool.id, null)}
                      >
                        Use default
                      </Button>
                    )}
                    <SegmentedControl
                      label={`${tool.label} permission`}
                      options={choices}
                      value={tool.override ?? permissions[kind]}
                      onSelect={(change) => updateTool(tool.id, change)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {!matches.length && (
        <EmptyState title={filter ? 'No matching tools' : 'No tools available'} />
      )}
    </section>
  )
}
