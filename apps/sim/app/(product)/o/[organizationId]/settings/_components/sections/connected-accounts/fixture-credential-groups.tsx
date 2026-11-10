'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsRow } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import { FieldStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { CredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/credential-groups'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'
import type { CredentialGroupsData } from '@/platform/lib/data/models/connected-accounts'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface FixtureSlackSetupProps {
  slackTeams: readonly string[]
  configured: boolean
  onAdd: () => Promise<void>
  onClose: () => void
}

/** The example's Slack setup: choosing the installed workspace adds the provider to the draft. */
function FixtureSlackSetup({ slackTeams, configured, onAdd, onClose }: FixtureSlackSetupProps) {
  const params = useSearchParams()
  const scope = useSurfaceScope()
  const [team, setTeam] = useState<string | null>(null)
  const selectedTeam = team ?? (slackTeams.length === 1 ? slackTeams[0] : null)
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Set up Slack app'
      confirmLabel={!slackTeams.length || configured ? 'Done' : 'Verify and add'}
      confirmDisabled={slackTeams.length > 1 && !selectedTeam}
      onConfirm={() => {
        if (selectedTeam && !configured) return onAdd()
      }}
    >
      <FieldStack>
        {slackTeams.length > 1 ? (
          <SearchableSelect
            label='Sim Search app'
            searchLabel='Search Slack workspaces'
            placeholder='Select the Slack workspace'
            options={slackTeams}
            value={selectedTeam}
            onValueChange={setTeam}
          />
        ) : (
          <SettingsRow
            label='Sim Search app'
            description={
              selectedTeam
                ? `Installed in ${selectedTeam}`
                : 'Install Sim Search in your Slack workspace to connect member accounts.'
            }
          />
        )}
        {selectedTeam && (
          <SettingsRow
            label='Member accounts'
            description='Verify member permissions. Members will need to reconnect if their app or permissions change.'
          />
        )}
        <Button
          render={
            <Link href={platformHref(surfaceHref(scope, '/settings/search-slack'), params)} />
          }
        >
          {selectedTeam ? 'Manage Sim Search app' : 'Install Sim Search'}
        </Button>
      </FieldStack>
    </Modal>
  )
}

/** Credential Groups on the session's example: every edit stays in the fixture draft. */
export function FixtureCredentialGroups({ data }: { data: CredentialGroupsData }) {
  const { data: groups, update } = useSettingsFixtureDraft('connected-accounts', data)
  const actions: CredentialGroupActions = {
    setUp: async () => update((current) => ({ ...current, setup: true })),
    addProvider: async (item) =>
      update((current) => ({ ...current, configured: [...current.configured, item.key] })),
    removeProvider: async (item) =>
      update((current) => ({
        ...current,
        configured: current.configured.filter((key) => key !== item.key),
        databricks: item.provider === 'databricks' ? undefined : current.databricks,
      })),
    updateConfigurations: async () => {
      toast.success('Configurations updated')
    },
    saveDatabricks: async ({ name, url, clientId, clientSecret }) =>
      update((current) => {
        const key = current.catalog.find((item) => item.provider === 'databricks')?.key
        return {
          ...current,
          databricks: {
            name,
            url,
            clientId,
            hasSecret: Boolean(clientSecret.trim() || current.databricks?.hasSecret),
          },
          configured:
            key && !current.configured.includes(key)
              ? [...current.configured, key]
              : current.configured,
        }
      }),
    invite: async (emails) => {
      update((current) => ({
        ...current,
        people: [
          ...current.people.filter((person) => !emails.includes(person.email.toLowerCase())),
          ...emails.map((email) => ({
            id: email,
            email,
            revoked: false,
            accounts:
              current.people.find((person) => person.email.toLowerCase() === email)?.accounts ?? [],
          })),
        ],
      }))
      return null
    },
    resend: async () => {
      toast.success('Connection request renewed')
    },
    revoke: async (personId) =>
      update((current) => ({
        ...current,
        people: current.people.map((person) =>
          person.id === personId ? { ...person, revoked: true, accounts: [] } : person
        ),
      })),
    saveGrants: async (grants) => update((current) => ({ ...current, grants })),
  }
  return (
    <CredentialGroups
      data={groups}
      actions={actions}
      shallow
      renderSlackSetup={(provider, onClose) => (
        <FixtureSlackSetup
          slackTeams={groups.slackTeams ?? []}
          configured={groups.configured.includes(provider.key)}
          onAdd={() => actions.addProvider(provider)}
          onClose={onClose}
        />
      )}
    />
  )
}
