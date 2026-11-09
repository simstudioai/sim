'use client'

import { toast } from '@/lib/toast/sink'
import { CredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/credential-groups'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'

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
  return <CredentialGroups data={groups} actions={actions} shallow />
}
