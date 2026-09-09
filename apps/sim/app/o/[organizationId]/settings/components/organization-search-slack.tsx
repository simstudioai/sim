'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, ChipSwitch, OverflowText } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { SlackSearchSetupWizard } from '@/components/integrations/slack-search-setup-wizard'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { slackSetupResultParam } from '@/app/o/[organizationId]/settings/components/search-params'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useConfigureSlackSearch,
  useRemoveSlackSearch,
  useSlackSearchInstallations,
} from '@/hooks/queries/slack-search'

/** Organization-owned Search bots are installed through the dedicated OAuth wizard. */
export function OrganizationSearchSlack() {
  const { organization, viewer } = useOrganizationContext()
  const installations = useSlackSearchInstallations(viewer.isAdmin ? organization.id : undefined)
  const configure = useConfigureSlackSearch()
  const remove = useRemoveSlackSearch()
  const [setupResult, setSetupResult] = useQueryState(
    slackSetupResultParam.key,
    slackSetupResultParam.parser
  )
  const [wizard, setWizard] = useState<{
    installationId?: string
    appId?: string
    initialName?: string
  } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  if (!viewer.isAdmin) return null
  const busy = configure.isPending || remove.isPending
  const error = configure.error ?? remove.error
  const bots = installations.data?.bots ?? []

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <p className='text-[var(--text-secondary)] text-sm'>
        Members can DM the bot or mention it in a channel to receive a private answer about
        knowledge they can access in Sim. Their Slack email must match their verified Sim account in
        this organization.
      </p>
      {setupResult === 'complete' && (
        <div role='status' className='flex flex-col gap-2'>
          <p className='text-[var(--text-body)] text-sm'>
            Step 4 of 4 · Slack Search is connected and enabled.
          </p>
          <p className='text-[var(--text-secondary)] text-caption'>
            Open the bot in Slack and send a question to try it.
          </p>
          <div>
            <Chip onClick={() => void setSetupResult(null)}>Done</Chip>
          </div>
        </div>
      )}
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
          {installations.data.installations.map((installation) => {
            const name =
              bots.find((bot) => bot.id === installation.credentialId)?.displayName ??
              installation.teamName
            return (
              <div
                key={installation.id}
                className='flex flex-col gap-3 border-[var(--border)] border-b pb-4'
              >
                <div className='flex items-center justify-between gap-4'>
                  <div className='min-w-0'>
                    <OverflowText label={name} className='text-[var(--text-primary)] text-sm' />
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
                    Reconnect the bot to validate its credentials and permissions.
                  </p>
                )}
                {['delivery_failed', 'assistant_or_delivery_failed'].includes(
                  installation.lastOutcome ?? ''
                ) && (
                  <p className='text-[var(--text-error)] text-caption'>
                    The last reply could not be completed. Check the Slack connection.
                  </p>
                )}
                <div className='flex flex-wrap gap-2'>
                  <ChipLink
                    href={`https://slack.com/app_redirect?app=${encodeURIComponent(installation.appId)}&team=${encodeURIComponent(installation.teamId)}`}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Open in Slack
                  </ChipLink>
                  <Chip
                    disabled={busy}
                    onClick={() =>
                      setWizard({
                        installationId: installation.id,
                        appId: installation.appId,
                        initialName: name,
                      })
                    }
                  >
                    Reconnect
                  </Chip>
                  <Chip
                    disabled={busy}
                    onClick={() => setRemoveTarget({ id: installation.id, name })}
                  >
                    Remove from Search
                  </Chip>
                </div>
              </div>
            )
          })}
          <div>
            <Chip disabled={busy} onClick={() => setWizard({})}>
              Set up Slack Search
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
      {removeTarget && (
        <ChipConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
          title='Remove Slack Search'
          text={`Remove ${removeTarget.name} from Slack Search? Pending replies will be cancelled.`}
          confirm={{
            label: 'Remove',
            pending: remove.isPending,
            pendingLabel: 'Removing…',
            onClick: () =>
              remove.mutate(
                { organizationId: organization.id, installationId: removeTarget.id },
                { onSuccess: () => setRemoveTarget(null) }
              ),
          }}
        />
      )}
      {wizard && (
        <SlackSearchSetupWizard
          key={wizard.installationId ?? 'new'}
          organizationId={organization.id}
          {...wizard}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  )
}
