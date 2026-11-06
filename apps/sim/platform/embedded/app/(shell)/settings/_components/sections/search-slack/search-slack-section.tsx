'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { slackSetupResultParam } from '@/app/o/[organizationId]/settings/components/search-params'
import {
  useConfigureSlackSearch,
  useRemoveSlackSearch,
  useSlackSearchInstallations,
} from '@/hooks/queries/slack-search'
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  errorMessageOr,
  Icon,
  InlineNotice,
  QueryBoundary,
  StatusTag,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  ActionRow,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { SlackSetupWizard } from '@/platform/embedded/app/(shell)/settings/_components/sections/search-slack/slack-setup-wizard'

interface WizardState {
  mode?: 'custom' | 'shared'
  installationId?: string
  appId?: string
  initialName?: string
}

const SLACK_MARK = <Icon providerId='slack' />

/** Organization-owned Search bots are installed through the dedicated OAuth wizard. */
export default function SearchSlackSection({ organization: context }: SettingsSectionProps) {
  const { organization, viewer } = context
  const setupToastShown = useRef(false)
  const installations = useSlackSearchInstallations(viewer.isAdmin ? organization.id : undefined)
  const configure = useConfigureSlackSearch()
  const remove = useRemoveSlackSearch()
  const [setupResult, setSetupResult] = useQueryState(
    slackSetupResultParam.key,
    slackSetupResultParam.parser
  )
  const [wizard, setWizard] = useState<WizardState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!viewer.isAdmin || setupResult !== 'complete' || setupToastShown.current) return
    setupToastShown.current = true
    toast.success('Slack connected')
    void setSetupResult(null)
  }, [viewer.isAdmin, setupResult, setSetupResult])

  if (!viewer.isAdmin) return null
  const busy = configure.isPending || remove.isPending
  const bots = installations.data?.bots ?? []
  const canInstallSharedApp = !installations.error && installations.data?.sharedAppAvailable
  const sharedTeams = new Set(
    installations.data?.installations
      .filter((installation) => installation.appKind === 'shared')
      .map((installation) => installation.teamId)
  )

  return (
    <SectionStack>
      <SettingsSection title='Connection'>
        <QueryBoundary
          query={installations}
          failure={errorMessageOr('Could not load Slack connections')}
          loadingLabel='Loading Slack connection'
          rows={1}
        >
          {(data) =>
            data.installations.length === 0 ? (
              <SettingsRow
                label='Slack'
                description='Connect your workspace to ask questions in Slack.'
                leading={SLACK_MARK}
              >
                <Button
                  variant='primary'
                  size='compact'
                  onClick={() => setWizard(canInstallSharedApp ? { mode: 'shared' } : {})}
                >
                  {data.sharedAppAvailable ? 'Install Sim Search' : 'Set up'}
                </Button>
              </SettingsRow>
            ) : (
              data.installations.map((installation) => {
                const custom = installation.appKind === 'custom'
                const name = custom ? 'Sim Search (custom bot)' : 'Sim Search'
                const needsInstall =
                  canInstallSharedApp && custom && !sharedTeams.has(installation.teamId)
                const connectionError = needsInstall
                  ? null
                  : installation.needsValidation
                    ? 'Reconnect to verify the app’s credentials and permissions.'
                    : ['delivery_failed', 'assistant_or_delivery_failed'].includes(
                          installation.lastOutcome ?? ''
                        )
                      ? 'The last reply failed. Check the Slack connection.'
                      : null
                const reconnectRequired = needsInstall || installation.needsValidation
                return (
                  <SettingsRow
                    key={installation.id}
                    label={name}
                    description={connectionError ?? installation.teamName}
                    leading={SLACK_MARK}
                  >
                    <ActionRow>
                      <StatusTag
                        label={
                          reconnectRequired
                            ? 'Reconnect required'
                            : installation.enabled
                              ? 'Enabled'
                              : 'Disabled'
                        }
                        intent={reconnectRequired || connectionError ? 'danger' : 'neutral'}
                      />
                      <Button
                        size='compact'
                        render={
                          <a
                            href={`https://slack.com/app_redirect?app=${encodeURIComponent(installation.appId)}&team=${encodeURIComponent(installation.teamId)}`}
                            target='_blank'
                            rel='noopener noreferrer'
                          >
                            Open in Slack
                          </a>
                        }
                      >
                        Open in Slack
                      </Button>
                      <ActionMenu
                        label={`${name} actions`}
                        icon='I108'
                        actions={[
                          {
                            id: 'reconnect',
                            label: needsInstall ? 'Install Sim Search' : 'Reconnect',
                            disabled: busy,
                            onSelect: () =>
                              setWizard({
                                mode: needsInstall ? 'shared' : installation.appKind,
                                installationId: installation.id,
                                appId: installation.appId,
                                initialName:
                                  custom && !needsInstall
                                    ? bots.find((bot) => bot.id === installation.credentialId)
                                        ?.displayName
                                    : undefined,
                              }),
                          },
                          {
                            id: 'toggle',
                            label: installation.enabled
                              ? 'Disable'
                              : installation.needsValidation
                                ? 'Enable (reconnect first)'
                                : 'Enable',
                            disabled:
                              busy || (!installation.enabled && installation.needsValidation),
                            onSelect: () =>
                              configure.mutate({
                                organizationId: organization.id,
                                credentialId: installation.credentialId,
                                enabled: !installation.enabled,
                              }),
                          },
                          {
                            id: 'remove',
                            label: 'Remove from Search',
                            destructive: true,
                            separatorBefore: true,
                            disabled: busy,
                            onSelect: () => {
                              remove.reset()
                              setRemoveTarget({ id: installation.id, name })
                            },
                          },
                        ]}
                      />
                    </ActionRow>
                  </SettingsRow>
                )
              })
            )
          }
        </QueryBoundary>
      </SettingsSection>
      {configure.error && <InlineNotice intent='danger' message={configure.error.message} />}
      {configure.isPending && <Muted>Updating the Slack connection</Muted>}
      {removeTarget && (
        <ConfirmDialog
          target
          onClose={() => setRemoveTarget(null)}
          title='Remove Slack Search'
          confirmLabel='Remove'
          pendingLabel='Removing'
          onConfirm={async () => {
            await remove.mutateAsync({
              organizationId: organization.id,
              installationId: removeTarget.id,
            })
          }}
          safe
        >
          <Muted>
            {`Remove ${removeTarget.name} from Slack Search? Pending replies will be cancelled.`}
          </Muted>
        </ConfirmDialog>
      )}
      {wizard && (
        <SlackSetupWizard
          key={wizard.installationId ?? 'new'}
          organizationId={organization.id}
          mode={wizard.mode}
          installationId={wizard.installationId}
          appId={wizard.appId}
          initialName={wizard.initialName}
          onClose={() => setWizard(null)}
        />
      )}
    </SectionStack>
  )
}
