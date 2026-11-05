'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/_components/chat/cards/cards.module.css'
import type {
  CredentialCardProps,
  UsageNoticeProps,
} from '@/platform/app/(shell)/_components/chat/message/message-segments'
import type { PlatformCredentialRequest } from '@/platform/app/(shell)/_components/chat/model'
import { Button, InlineNotice } from '@/platform/design-system/components'
import { Input } from '@/platform/design-system/components/field/inputs'
import {
  CredentialWorkspaceProvider,
  useCredentialWorkspace,
  useFolderAccess,
  useIntegrationsHref,
  useOAuthChipConnection,
  useSearchConnectionRow,
  useSecretSaver,
  useUsageLink,
} from '@/platform/lib/data/chat-credentials'
import type { SearchConnectionTarget } from '@/platform/lib/data/chat-types'

function serviceName(item: PlatformCredentialRequest): string {
  return (item.provider ?? 'integration').replace(/[-_]/g, ' ')
}

interface RowProps {
  item: PlatformCredentialRequest
  controlId: string
  onConnected: () => void
}

function LinkRow({ item, controlId, onConnected }: RowProps) {
  const name = serviceName(item)
  const connection = useOAuthChipConnection({
    connectUrl: item.value ?? '',
    provider: item.provider ?? '',
    displayName: name,
    controlId,
    onConnected,
  })
  if (connection.connected) return <p data-type='T048'>Connected {name}</p>
  return (
    <a
      className={styles.link}
      data-type='T048'
      href={item.value}
      target='_blank'
      rel='noopener noreferrer'
      onClick={connection.onConnectClick}
    >
      {connection.status === 'pending'
        ? `Waiting for ${name} connection`
        : connection.reconnectCredentialId
          ? `Reconnect ${name}`
          : `Connect ${name}`}
    </a>
  )
}

function SearchRow({
  item,
  target,
  controlId,
  onConnected,
}: RowProps & { target: SearchConnectionTarget }) {
  const name = serviceName(item)
  const connection = useSearchConnectionRow(target, controlId, onConnected)
  const label = connection.connected
    ? `Connected ${name}`
    : connection.pending
      ? `Waiting for ${name} connection`
      : connection.available
        ? `Connect ${name}`
        : `${name} connection is no longer available`
  return (
    <div className={styles.row}>
      <Button
        variant='muted'
        size='compact'
        disabled={
          connection.isLoading ||
          connection.isStarting ||
          connection.connected ||
          (!connection.available && !connection.pending)
        }
        onClick={() => void connection.connect()}
      >
        {label}
      </Button>
      {connection.pending && (
        <Button variant='muted' size='compact' onClick={connection.cancel}>
          Cancel
        </Button>
      )}
      {connection.error && <InlineNotice intent='danger' message={connection.error} />}
    </div>
  )
}

function FolderRow({ item }: { item: PlatformCredentialRequest }) {
  const [granted, setGranted] = useState(false)
  const access = useFolderAccess()
  if (!access) return null
  return (
    <Button
      variant='muted'
      size='compact'
      disabled={granted}
      onClick={async () => {
        if (await access(item.name)) setGranted(true)
      }}
    >
      {granted ? `Access granted — ${item.name ?? 'folder'}` : 'Grant folder access'}
    </Button>
  )
}

const CARD_TYPES = new Set(['secret_input', 'link', 'service_account', 'sim_key'])

/**
 * The `<credential>` card. An unanswered card holds the turn, so every row either works here or
 * sends the person to the surface that owns it, and Submit reports names only, never values.
 */
export function LiveCredentialCard({
  items,
  submission,
  abandoned,
  onSubmit,
}: CredentialCardProps) {
  const { workspaceId, canEdit } = useCredentialWorkspace(items)
  const saver = useSecretSaver(items)
  const integrationsHref = useIntegrationsHref()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [savedRows, setSavedRows] = useState<ReadonlySet<number>>(new Set())
  const [connected, setConnected] = useState<ReadonlySet<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const secretRows = items.flatMap((item, index) =>
    item.type === 'secret_input' && item.name ? [{ index, name: item.name }] : []
  )
  const integrationRows = items.flatMap((item, index) =>
    item.type === 'link' || item.type === 'service_account' ? [{ item, index }] : []
  )

  if (submission || abandoned || submitted) {
    const saved = new Set(submission?.saved ?? [])
    const named = [
      ...integrationRows.map(({ item, index }) => ({
        label: serviceName(item),
        status: (submission ? saved.has(item.provider ?? '') : connected.has(index))
          ? 'Connected'
          : 'Skipped',
      })),
      ...secretRows.map(({ name, index }) => ({
        label: name,
        status: (submission ? saved.has(name) : savedRows.has(index)) ? 'Added' : 'Skipped',
      })),
    ]
    return (
      <dl className={styles.fields}>
        {named.map(({ label, status }) => (
          <div key={label}>
            <dt data-type='T052'>{label}</dt>
            <dd data-type='T048'>{status}</dd>
          </div>
        ))}
      </dl>
    )
  }

  const organizationGate = saver.gate

  async function submit() {
    setSaving(true)
    const result = await saver.submit({ drafts, saved: savedRows, connected, workspaceId })
    setSavedRows(result.saved)
    setSaving(false)
    if (result.message === null) return
    setSubmitted(true)
    onSubmit(result.message)
  }

  const isCard = items.every((item) => CARD_TYPES.has(item.type))
  return (
    <CredentialWorkspaceProvider value={workspaceId}>
      <section className={styles.card} aria-label='Set up credentials'>
        {items.map((item, index) => {
          const controlId = `credential:${index}`
          const markConnected = () => setConnected((current) => new Set(current).add(index))
          switch (item.type) {
            case 'link':
              if (!item.provider) return null
              return item.searchTarget ? (
                <SearchRow
                  key={controlId}
                  item={item}
                  target={item.searchTarget}
                  controlId={controlId}
                  onConnected={markConnected}
                />
              ) : canEdit ? (
                <LinkRow
                  key={controlId}
                  item={item}
                  controlId={controlId}
                  onConnected={markConnected}
                />
              ) : null
            case 'secret_input':
              if (item.scope === 'organization' && organizationGate) return null
              if ((item.scope ?? 'workspace') === 'workspace' && !canEdit) return null
              return savedRows.has(index) ? (
                <p key={controlId} data-type='T048'>
                  {item.name} added
                </p>
              ) : (
                <Input
                  key={controlId}
                  label={item.name ?? 'Secret'}
                  placeholder={item.name}
                  type='password'
                  value={drafts[index] ?? ''}
                  onChange={(value) => setDrafts((current) => ({ ...current, [index]: value }))}
                />
              )
            case 'service_account':
              return canEdit ? (
                <a
                  key={controlId}
                  className={styles.link}
                  data-type='T048'
                  href={integrationsHref}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  Connect {serviceName(item)} in Integrations
                </a>
              ) : null
            case 'folder_access':
              return <FolderRow key={controlId} item={item} />
            case 'sim_key':
              return item.value ? (
                <code key={controlId} data-type='T009'>
                  {item.value}
                </code>
              ) : null
            default:
              return null
          }
        })}
        {organizationGate && <InlineNotice message={organizationGate} />}
        {isCard && (secretRows.length > 0 || integrationRows.length > 0) && (
          <div className={styles.actions}>
            <Button
              variant='primary'
              size='compact'
              disabled={saving}
              onClick={() => void submit()}
            >
              Submit
            </Button>
          </div>
        )}
      </section>
    </CredentialWorkspaceProvider>
  )
}

/** Usage and plan refusals: admins get the billing route, everyone else who to ask. */
export function LiveUsageNotice({ action, reason, message }: UsageNoticeProps) {
  const { canManage, upgrade, href } = useUsageLink(action)
  if (reason === 'job_run_budget')
    return <InlineNotice intent='warning' title='Run Spend Limit Reached' message={message} />
  return (
    <InlineNotice
      intent='warning'
      title={reason === 'chat_plan_required' ? 'Paid Plan Required' : 'Usage Limit Reached'}
      message={
        canManage
          ? message
          : `${message} Contact an organization admin to ${upgrade ? "upgrade this organization's plan" : 'manage usage limits'}.`
      }
      action={
        canManage ? (
          <a className={styles.link} data-type='T048' href={href}>
            {upgrade ? 'Upgrade Plan' : 'Increase Limit'}
          </a>
        ) : undefined
      }
    />
  )
}
