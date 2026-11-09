'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { ActionRow } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SlackSearchInstallationView } from '@/platform/lib/data/settings-slack'
import {
  needsSharedInstall,
  type SetupTarget,
  type SlackSearchConsole,
  slackSetupFor,
} from '@/platform/lib/data/slack-search-model'

interface SlackConnectionsProps {
  connections: SlackSearchConsole
  /** The setup dialog for a target, with the bot's saved name when reconnecting a custom app. */
  renderSetup: (target: SetupTarget, botName: string | undefined, close: () => void) => ReactNode
}

function botName(bot: SlackSearchInstallationView) {
  return bot.appKind === 'shared' ? 'Sim Search' : 'Sim Search (custom bot)'
}

export function SlackConnections({ connections, renderSetup }: SlackConnectionsProps) {
  const { list, busy, canSetUp } = connections
  const [setup, setSetup] = useState<{ target: SetupTarget; botName?: string }>()
  const [removing, setRemoving] = useState<SlackSearchInstallationView>()
  const rows = list?.installations ?? []
  const shared = list?.sharedAppAvailable === true
  return (
    <SettingsSection title='Connection'>
      {list === null ? (
        <FailureNotice message='Could not load Slack connections' onRetry={connections.retry} />
      ) : list === undefined ? null : rows.length === 0 ? (
        <SettingsRow
          leading={<Icon providerId='slack' />}
          label='Slack'
          description='Connect your workspace to ask questions in Slack.'
        >
          <Button
            size='compact'
            variant='primary'
            disabled={!canSetUp}
            onClick={() => setSetup(slackSetupFor(list))}
          >
            {shared ? 'Install Sim Search' : 'Set up'}
          </Button>
        </SettingsRow>
      ) : (
        rows.map((bot) => {
          const needsInstall = needsSharedInstall(list, bot)
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
                <ActionMenu
                  icon='I108'
                  label={`${botName(bot)} actions`}
                  tooltip={false}
                  actions={[
                    {
                      id: 'connect',
                      label: needsInstall ? 'Install Sim Search' : 'Reconnect',
                      disabled: busy || !canSetUp,
                      onSelect: () => setSetup(slackSetupFor(list, bot)),
                    },
                    {
                      id: 'toggle',
                      label: bot.enabled ? 'Disable' : 'Enable',
                      disabled: busy || (!bot.enabled && bot.needsValidation),
                      onSelect: () => connections.toggle(bot),
                    },
                    {
                      id: 'remove',
                      label: 'Remove from Search',
                      destructive: true,
                      separatorBefore: true,
                      disabled: busy,
                      onSelect: () => setRemoving(bot),
                    },
                  ]}
                />
              </ActionRow>
            </SettingsRow>
          )
        })
      )}
      {connections.updateError && (
        <InlineNotice intent='danger' message={connections.updateError} />
      )}
      {setup && renderSetup(setup.target, setup.botName, () => setSetup(undefined))}
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
          onConfirm={() => connections.remove(removing)}
        />
      )}
    </SettingsSection>
  )
}
