'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice, StatusTag } from '@sim/emcn/status'
import { errorMessageOr, QueryBoundary } from '@sim/emcn/status/query-boundary'
import { useQueryState } from 'nuqs'
import { slackSetupResultParam } from '@/lib/organizations/slack-setup-params'
import {
  ActionRow,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { SlackSetupWizard } from '@/platform/embedded/app/(shell)/settings/_components/sections/search-slack/slack-setup-wizard'
import { useSlackSearchConnections } from '@/platform/embedded/lib/data/slack-search-handoff'
import { toast } from '@/platform/shared/toast'

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
  const connections = useSlackSearchConnections(organization.id, viewer.isAdmin)
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
  const { busy, canInstallSharedApp } = connections

  return (
    <SectionStack>
      <SettingsSection title='Connection'>
        <QueryBoundary
          query={connections.read}
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
                const { custom, name, needsInstall, connectionError, reconnectRequired, botName } =
                  connections.describe(installation)
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
                                initialName: custom && !needsInstall ? botName : undefined,
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
                            onSelect: () => connections.toggleEnabled(installation),
                          },
                          {
                            id: 'remove',
                            label: 'Remove from Search',
                            destructive: true,
                            separatorBefore: true,
                            disabled: busy,
                            onSelect: () => {
                              connections.resetRemove()
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
      {connections.updateError && (
        <InlineNotice intent='danger' message={connections.updateError.message} />
      )}
      {connections.updating && <Muted>Updating the Slack connection</Muted>}
      {removeTarget && (
        <ConfirmDialog
          target
          onClose={() => setRemoveTarget(null)}
          title='Remove Slack Search'
          confirmLabel='Remove'
          pendingLabel='Removing'
          onConfirm={() => connections.remove(removeTarget.id)}
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
