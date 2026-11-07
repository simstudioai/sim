'use client'

import { useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SourceSettingsData } from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

interface SecretSettingsProps {
  data: SourceSettingsData
  href: string
  update: (change: (data: SourceSettingsData) => SourceSettingsData) => void
}

export function SecretSettings({ data, href, update }: SecretSettingsProps) {
  const router = useRouter()
  const saved = () => data.secrets.map((name) => ({ id: name, name, value: '', saved: true }))
  const [rows, setRows] = useState(saved)
  const dirty =
    rows.length !== data.secrets.length ||
    rows.some((row, index) => row.name !== data.secrets[index] || row.value !== '')
  const names = rows.map((row) => row.name.trim())
  const valid =
    rows.every(
      (row) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name.trim()) && (row.saved || Boolean(row.value))
    ) && new Set(names).size === names.length
  const guard = useSettingsUnsavedGuard({ isDirty: dirty, onDiscard: () => setRows(saved()) })
  return (
    <SectionStack>
      <DetailHeader
        title='Generic Secrets'
        backLabel='Sources'
        onBack={() => guard.guardBack(() => router.push(href))}
      />
      <SettingsSection title='Organization secrets'>
        {!rows.length && <EmptyState title='No organization secrets' />}
        {rows.map((row) => (
          <SettingsRow key={row.id} field label={row.saved ? row.name : 'New secret'}>
            <FieldStack>
              <TextField
                label='Name'
                placeholder='API_KEY'
                value={row.name}
                onChange={(name) =>
                  setRows((items) =>
                    items.map((item) => (item.id === row.id ? { ...item, name } : item))
                  )
                }
              />
              <SecretField
                label='Value'
                placeholder={row.saved ? '••••••••' : 'Enter value'}
                value={row.value}
                onChange={(value) =>
                  setRows((items) =>
                    items.map((item) => (item.id === row.id ? { ...item, value } : item))
                  )
                }
              />
              <IconButton
                icon='I061'
                label={`Remove ${row.name || 'secret'}`}
                onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}
              />
            </FieldStack>
          </SettingsRow>
        ))}
        <SettingsRow label='Add secret'>
          <Button
            size='compact'
            icon='I074'
            onClick={() =>
              setRows((items) => [
                ...items,
                { id: generateId(), name: '', value: '', saved: false },
              ])
            }
          >
            Add secret
          </Button>
        </SettingsRow>
        {dirty && (
          <ActionRow>
            <Button
              variant='primary'
              disabled={!valid}
              onClick={() => {
                update((current) => ({ ...current, secrets: names }))
                setRows(
                  rows.map((row) => ({ ...row, name: row.name.trim(), value: '', saved: true }))
                )
              }}
            >
              Save
            </Button>
            <Button variant='quiet' onClick={() => setRows(saved())}>
              Discard
            </Button>
          </ActionRow>
        )}
      </SettingsSection>
    </SectionStack>
  )
}
