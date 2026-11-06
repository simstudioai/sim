'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ActionRow } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  type ManifestView,
  type SetupTarget,
  SlackSetupDialog,
} from '@/platform/app/(shell)/settings/_components/sections/search-slack/slack-setup-dialog'
import {
  ActionMenu,
  Button,
  FailureNotice,
  Icon,
  Modal,
  StatusTag,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'
import type {
  SlackSearchInstallationView,
  SlackSearchList,
} from '@/platform/lib/data/settings-slack'

interface SlackConnectionsProps {
  initial: SlackSearchList | null
  prospective?: SlackSearchInstallationView
  manageHref: string
  manifest: ManifestView
  botManifests: Record<string, ManifestView>
}

function botName(bot: SlackSearchInstallationView) {
  return bot.appKind === 'shared' ? 'Sim Search' : 'Sim Search (custom bot)'
}

export function SlackConnections({
  initial,
  prospective,
  manageHref,
  manifest,
  botManifests,
}: SlackConnectionsProps) {
  const router = useRouter()
  const { data: rows, update } = useSettingsFixtureDraft(
    'search-slack',
    initial?.installations ?? []
  )
  const [setup, setSetup] = useState<SetupTarget>()
  const [removing, setRemoving] = useState<SlackSearchInstallationView>()
  const sharedTeams = new Set(
    rows.filter((row) => row.appKind === 'shared').map((row) => row.teamId)
  )
  const shared = initial?.sharedAppAvailable === true
  function connect() {
    if (!setup || !prospective) return
    const source = setup.previous ?? prospective
    const next = {
      ...source,
      appKind: setup.mode,
      enabled: true,
      needsValidation: false,
      lastOutcome: null,
    }
    update((current) =>
      setup.previous
        ? current.map((row) => (row.id === source.id ? next : row))
        : [...current, next]
    )
  }
  return (
    <SettingsSection title='Connection'>
      {initial === null ? (
        <FailureNotice
          message='Could not load Slack connections'
          onRetry={() => router.refresh()}
        />
      ) : rows.length === 0 ? (
        <SettingsRow
          leading={<Icon providerId='slack' />}
          label='Slack'
          description='Connect your workspace to ask questions in Slack.'
        >
          <Button
            size='compact'
            variant='primary'
            render={prospective ? undefined : <a href={manageHref}>Manage Slack connection</a>}
            onClick={
              prospective ? () => setSetup({ mode: shared ? 'shared' : 'custom' }) : undefined
            }
          >
            {shared ? 'Install Sim Search' : 'Set up'}
          </Button>
        </SettingsRow>
      ) : (
        rows.map((bot) => {
          const needsInstall = shared && bot.appKind === 'custom' && !sharedTeams.has(bot.teamId)
          const reconnect = needsInstall || bot.needsValidation
          const description = needsInstall
            ? bot.teamName
            : bot.needsValidation
              ? 'Reconnect to verify the app’s credentials and permissions.'
              : bot.lastOutcome === 'delivery_failed' ||
                  bot.lastOutcome === 'assistant_or_delivery_failed'
                ? 'The last reply failed. Check the Slack connection.'
                : bot.teamName
          return (
            <SettingsRow
              key={bot.id}
              leading={<Icon providerId='slack' />}
              label={botName(bot)}
              description={description}
            >
              <ActionRow>
                <StatusTag
                  label={reconnect ? 'Reconnect required' : bot.enabled ? 'Enabled' : 'Disabled'}
                  intent={reconnect ? 'warning' : bot.enabled ? 'success' : 'neutral'}
                />
                <Button
                  size='compact'
                  variant='quiet'
                  render={
                    <a
                      aria-label='Open in Slack'
                      href={`https://slack.com/app_redirect?app=${encodeURIComponent(bot.appId)}&team=${encodeURIComponent(bot.teamId)}`}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      Open in Slack
                    </a>
                  }
                >
                  Open in Slack
                </Button>
                {prospective ? (
                  <ActionMenu
                    icon='I108'
                    label={`${botName(bot)} actions`}
                    tooltip={false}
                    actions={[
                      {
                        id: 'connect',
                        label: needsInstall ? 'Install Sim Search' : 'Reconnect',
                        onSelect: () =>
                          setSetup({ mode: needsInstall ? 'shared' : bot.appKind, previous: bot }),
                      },
                      {
                        id: 'toggle',
                        label: bot.enabled ? 'Disable' : 'Enable',
                        disabled: !bot.enabled && bot.needsValidation,
                        onSelect: () =>
                          update((current) =>
                            current.map((row) =>
                              row.id === bot.id ? { ...row, enabled: !row.enabled } : row
                            )
                          ),
                      },
                      {
                        id: 'remove',
                        label: 'Remove from Search',
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => setRemoving(bot),
                      },
                    ]}
                  />
                ) : (
                  <Button size='compact' render={<a href={manageHref}>Manage Slack connection</a>}>
                    Manage
                  </Button>
                )}
              </ActionRow>
            </SettingsRow>
          )
        })
      )}
      {setup && (
        <SlackSetupDialog
          target={setup}
          manifest={(setup.previous && botManifests[setup.previous.credentialId]) || manifest}
          onClose={() => setSetup(undefined)}
          onConnect={connect}
        />
      )}
      {removing && (
        <Modal
          open
          variant='confirm'
          destructive
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined)
          }}
          title='Remove Slack Search'
          description={`Remove ${botName(removing)} from Slack Search? Pending replies will be cancelled.`}
          confirmLabel='Remove'
          onConfirm={() => update((current) => current.filter((row) => row.id !== removing.id))}
        />
      )}
    </SettingsSection>
  )
}
