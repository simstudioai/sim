'use client'

import { useState } from 'react'
import {
  ActionRow,
  FieldStack,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  Button,
  InlineNotice,
  SearchableSelect,
  TextField,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'

interface ByokProps {
  organization: PlatformOrganization
}

export function MothershipByok({ organization }: ByokProps) {
  const preview = useFixtureSettingsActions()?.previewByokWorkspaces
  const [target, setTarget] = useState('')
  const [inspected, setInspected] = useState('')
  const workspace = preview?.find((item) => item.id === inspected)
  const id = target.trim()
  return (
    <SettingsSection title='Workspace keys'>
      <FieldStack>
        <Muted>
          Mothership uses the workspace’s Anthropic key, including keys inherited from its
          organization.
        </Muted>
        {preview ? (
          <SearchableSelect
            label='Target workspace'
            searchLabel='Search workspaces'
            placeholder='Choose a workspace'
            options={preview.map(({ id, name }) => ({ value: id, label: name }))}
            value={target}
            onValueChange={(value) => {
              setTarget(value ?? '')
              setInspected('')
            }}
          />
        ) : (
          <TextField
            label='Target workspace'
            placeholder='Workspace ID'
            value={target}
            onChange={setTarget}
          />
        )}
        <ActionRow>
          {preview ? (
            <Button size='compact' disabled={!id} onClick={() => setInspected(id)}>
              View workspace BYOK keys
            </Button>
          ) : (
            <Button
              size='compact'
              disabled={!id}
              render={
                id ? (
                  <a
                    href={`${legacyRoutes(organization).workspace(encodeURIComponent(id))}/settings/byok`}
                  >
                    Manage workspace BYOK keys
                  </a>
                ) : undefined
              }
            >
              Manage workspace BYOK keys
            </Button>
          )}
        </ActionRow>
        {workspace && (
          <InlineNotice title={workspace.name} message={`Anthropic · ${workspace.keySource}`} />
        )}
      </FieldStack>
    </SettingsSection>
  )
}
