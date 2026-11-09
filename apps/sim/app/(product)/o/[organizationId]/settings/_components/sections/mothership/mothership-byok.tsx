'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import {
  ActionRow,
  FieldStack,
  Muted,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'
import { platformHref } from '@/platform/lib/navigation'

export function MothershipByok() {
  const preview = useFixtureSettingsActions()?.previewByokWorkspaces
  const search = useSearchParams()
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
                  <Link href={platformHref(workspacePath(id, 'settings/byok'), search)}>
                    Manage workspace BYOK keys
                  </Link>
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
