'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, ChipModalError, ChipTag } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { SlackIcon } from '@/components/icons'
import { SlackSearchSetupWizard } from '@/components/integrations/slack-search-setup-wizard'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { slackSetupResultParam } from '@/app/o/[organizationId]/settings/components/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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
  const bots = installations.data?.bots ?? []

  return (
    <SettingsPanel>
      <div className='flex max-w-xl flex-col gap-4'>
        {setupResult === 'complete' && (
          <div role='status' className='flex items-center justify-between gap-2'>
            <p className='text-[var(--text-body)] text-sm'>Slack is connected and ready to use.</p>
            <Chip onClick={() => void setSetupResult(null)}>Dismiss</Chip>
          </div>
        )}
        <SettingsSection label='Connection'>
          {installations.error ? (
            <SettingsQueryErrorState
              error={installations.error}
              fallback='Could not load Slack connections'
              isRetrying={installations.isFetching}
              onRetry={() => void installations.refetch()}
              variant='inline'
            />
          ) : !installations.data ? (
            <SettingsEmptyState variant='inline'>Loading Slack connection…</SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {installations.data.installations.length === 0 ? (
                <SettingsResourceRow
                  icon={<SlackIcon />}
                  title='Slack'
                  description='Connect your workspace to ask questions in Slack.'
                  trailing={
                    <Chip variant='primary' onClick={() => setWizard({})}>
                      Set up
                    </Chip>
                  }
                />
              ) : (
                installations.data.installations.map((installation) => {
                  const name =
                    bots.find((bot) => bot.id === installation.credentialId)?.displayName ??
                    installation.teamName
                  const connectionError = installation.needsValidation
                    ? 'Reconnect to verify the app’s credentials and permissions.'
                    : ['delivery_failed', 'assistant_or_delivery_failed'].includes(
                          installation.lastOutcome ?? ''
                        )
                      ? 'The last reply failed. Check the Slack connection.'
                      : null
                  return (
                    <SettingsResourceRow
                      key={installation.id}
                      icon={<SlackIcon />}
                      title={name}
                      description={
                        connectionError ? (
                          <span className='text-[var(--text-error)]'>{connectionError}</span>
                        ) : (
                          installation.teamName
                        )
                      }
                      badge={
                        <ChipTag>
                          {installation.needsValidation
                            ? 'Reconnect required'
                            : installation.enabled
                              ? 'Enabled'
                              : 'Disabled'}
                        </ChipTag>
                      }
                      trailing={
                        <>
                          <ChipLink
                            href={`https://slack.com/app_redirect?app=${encodeURIComponent(installation.appId)}&team=${encodeURIComponent(installation.teamId)}`}
                            target='_blank'
                            rel='noopener noreferrer'
                          >
                            Open in Slack
                          </ChipLink>
                          <RowActionsMenu
                            label={`${name} actions`}
                            actions={[
                              {
                                label: 'Reconnect',
                                disabled: busy,
                                onSelect: () =>
                                  setWizard({
                                    installationId: installation.id,
                                    appId: installation.appId,
                                    initialName: name,
                                  }),
                              },
                              {
                                label: installation.enabled ? 'Disable' : 'Enable',
                                disabled:
                                  busy || (!installation.enabled && installation.needsValidation),
                                tooltip:
                                  installation.needsValidation && !installation.enabled
                                    ? 'Reconnect before enabling Search'
                                    : undefined,
                                onSelect: () =>
                                  configure.mutate({
                                    organizationId: organization.id,
                                    credentialId: installation.credentialId,
                                    enabled: !installation.enabled,
                                  }),
                              },
                              {
                                label: 'Remove from Search',
                                destructive: true,
                                disabled: busy,
                                onSelect: () => {
                                  remove.reset()
                                  setRemoveTarget({ id: installation.id, name })
                                },
                              },
                            ]}
                          />
                        </>
                      }
                    />
                  )
                })
              )}
            </div>
          )}
        </SettingsSection>
        {configure.error && (
          <p role='alert' className='text-[var(--text-error)] text-sm'>
            {configure.error.message}
          </p>
        )}
        {configure.isPending && (
          <p role='status' className='text-[var(--text-muted)] text-caption'>
            Updating the Slack connection…
          </p>
        )}
      </div>
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
        >
          <ChipModalError>{remove.error?.message}</ChipModalError>
        </ChipConfirmModal>
      )}
      {wizard && (
        <SlackSearchSetupWizard
          key={wizard.installationId ?? 'new'}
          organizationId={organization.id}
          {...wizard}
          onClose={() => setWizard(null)}
        />
      )}
    </SettingsPanel>
  )
}
