'use client'

import { SlackSetupDialog } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/slack-setup-dialog'
import { SlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/slack-connections'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'
import type {
  SlackSearchInstallationView,
  SlackSearchList,
} from '@/platform/lib/data/settings-slack'
import type { ManifestView, SetupTarget } from '@/platform/lib/data/slack-search-model'

interface FixtureSlackConnectionsProps {
  initial: SlackSearchList
  prospective?: SlackSearchInstallationView
  manifest: ManifestView
  botManifests: Record<string, ManifestView>
}

/** The Connection section on the session's example: every change stays in the fixture draft. */
export function FixtureSlackConnections({
  initial,
  prospective,
  manifest,
  botManifests,
}: FixtureSlackConnectionsProps) {
  const { data: rows, update } = useSettingsFixtureDraft('search-slack', initial.installations)
  function connect(target: SetupTarget) {
    if (!prospective) return
    const source = target.previous ?? prospective
    const next = {
      ...source,
      appKind: target.mode,
      enabled: true,
      needsValidation: false,
      lastOutcome: null,
    }
    update((current) =>
      target.previous
        ? current.map((row) => (row.id === source.id ? next : row))
        : [...current, next]
    )
  }
  return (
    <SlackConnections
      connections={{
        list: { ...initial, installations: rows },
        retry: () => {},
        busy: false,
        canSetUp: Boolean(prospective),
        updating: false,
        toggle: (bot) =>
          update((current) =>
            current.map((row) => (row.id === bot.id ? { ...row, enabled: !row.enabled } : row))
          ),
        remove: async (bot) => update((current) => current.filter((row) => row.id !== bot.id)),
      }}
      renderSetup={(target, _botName, close) => (
        <SlackSetupDialog
          target={target}
          flow={{
            manifest: (target.previous && botManifests[target.previous.credentialId]) || manifest,
            existingAppId: target.previous?.appId,
            sharedAvailable: initial.sharedAppAvailable,
            retryManifest: () => {},
            retrying: false,
            pending: false,
            close,
            installShared: () => {
              connect(target)
              return true
            },
            connect: async () => connect(target),
          }}
        />
      )}
    />
  )
}
