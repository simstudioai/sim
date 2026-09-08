'use client'

import { useState } from 'react'
import { Chip, ChipDropdown, ChipSwitch } from '@sim/emcn'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useConfigureSlackSearch,
  useRemoveSlackSearch,
  useSlackSearchInstallations,
} from '@/hooks/queries/slack-search'

/** Organization admins bind an existing custom bot or create one using the DM Search manifest. */
export function OrganizationSearchSlack() {
  const { organization, viewer } = useOrganizationContext()
  const installations = useSlackSearchInstallations(viewer.isAdmin ? organization.id : undefined)
  const configure = useConfigureSlackSearch()
  const remove = useRemoveSlackSearch()
  const [selectedBot, setSelectedBot] = useState('')
  const [modal, setModal] = useState<{ credentialId?: string; displayName?: string } | null>(null)
  if (!viewer.isAdmin) return null
  const busy = configure.isPending || remove.isPending
  const error = configure.error ?? remove.error
  const bots = installations.data?.bots ?? []
  const availableBots = bots.filter(
    (bot) =>
      !installations.data?.installations.some(
        (installation) => installation.credentialId === bot.id
      )
  )

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <p className='text-[var(--text-secondary)] text-sm'>
        Members can DM the bot to find documents they can access in Sim Search. Their Slack email
        must match their verified Sim account in this organization.
      </p>
      {installations.error ? (
        <SettingsQueryErrorState
          error={installations.error}
          fallback='Could not load Slack bots'
          isRetrying={installations.isFetching}
          onRetry={() => void installations.refetch()}
          variant='inline'
        />
      ) : !installations.data ? (
        <p className='text-[var(--text-muted)] text-sm'>Loading Slack bots…</p>
      ) : (
        <>
          {installations.data.installations.map((installation) => (
            <div
              key={installation.id}
              className='flex flex-col gap-3 border-[var(--border-1)] border-b pb-4'
            >
              <div className='flex items-center justify-between gap-4'>
                <div className='min-w-0'>
                  <p className='truncate text-[var(--text-primary)] text-sm'>
                    {bots.find((bot) => bot.id === installation.credentialId)?.displayName ??
                      installation.teamName}
                  </p>
                  <p className='text-[var(--text-muted)] text-caption'>{installation.teamName}</p>
                </div>
                <fieldset disabled={busy}>
                  <ChipSwitch
                    aria-label={`Search in ${installation.teamName}`}
                    value={installation.enabled ? 'enabled' : 'disabled'}
                    options={[
                      { value: 'disabled', label: 'Off' },
                      { value: 'enabled', label: 'On' },
                    ]}
                    onChange={(value) =>
                      configure.mutate({
                        organizationId: organization.id,
                        credentialId: installation.credentialId,
                        enabled: value === 'enabled',
                      })
                    }
                  />
                </fieldset>
              </div>
              {installation.needsValidation && (
                <p className='text-[var(--text-error)] text-caption'>
                  The bot credential changed. Validate it to resume Search.
                </p>
              )}
              {installation.lastOutcome === 'delivery_failed' && (
                <p className='text-[var(--text-error)] text-caption'>
                  The last reply could not be delivered. Check the Slack connection.
                </p>
              )}
              <div className='flex flex-wrap gap-2'>
                {installation.needsValidation && (
                  <Chip
                    disabled={busy}
                    onClick={() =>
                      configure.mutate({
                        organizationId: organization.id,
                        credentialId: installation.credentialId,
                        enabled: true,
                      })
                    }
                  >
                    Validate and enable
                  </Chip>
                )}
                <Chip
                  disabled={busy}
                  onClick={() =>
                    setModal({
                      credentialId: installation.credentialId,
                      displayName: bots.find((bot) => bot.id === installation.credentialId)
                        ?.displayName,
                    })
                  }
                >
                  Reconnect
                </Chip>
                <Chip
                  disabled={busy}
                  onClick={() =>
                    remove.mutate({
                      organizationId: organization.id,
                      installationId: installation.id,
                    })
                  }
                >
                  Remove from Search
                </Chip>
              </div>
            </div>
          ))}
          {availableBots.length > 0 && (
            <div className='flex flex-wrap items-center gap-2'>
              <ChipDropdown
                value={selectedBot}
                onChange={setSelectedBot}
                options={availableBots.map((bot) => ({ value: bot.id, label: bot.displayName }))}
                placeholder='Choose a connected bot'
              />
              <Chip
                disabled={!selectedBot || busy}
                onClick={() =>
                  configure.mutate({
                    organizationId: organization.id,
                    credentialId: selectedBot,
                    enabled: true,
                  })
                }
              >
                Connect to Search
              </Chip>
              <Chip
                disabled={!selectedBot || busy}
                onClick={() =>
                  setModal({
                    credentialId: selectedBot,
                    displayName: bots.find((bot) => bot.id === selectedBot)?.displayName,
                  })
                }
              >
                Update bot permissions
              </Chip>
            </div>
          )}
          <div>
            <Chip disabled={busy} onClick={() => setModal({})}>
              Create a custom Slack bot
            </Chip>
          </div>
        </>
      )}
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-sm'>
          {error.message}
        </p>
      )}
      {configure.isPending && (
        <p role='status' className='text-[var(--text-muted)] text-caption'>
          Validating the Slack connection…
        </p>
      )}
      {modal && (
        <ConnectSlackBotModal
          key={modal.credentialId ?? 'new'}
          open
          purpose='search'
          organizationId={organization.id}
          credentialId={modal.credentialId}
          initialDisplayName={modal.displayName}
          onOpenChange={(open) => {
            if (!open) setModal(null)
          }}
          onCreated={(credentialId) => {
            setModal(null)
            configure.mutate({ organizationId: organization.id, credentialId, enabled: true })
          }}
        />
      )}
    </div>
  )
}
