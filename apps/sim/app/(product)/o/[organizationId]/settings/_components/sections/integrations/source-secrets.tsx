'use client'

import { useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { SettingsRow } from '@sim/emcn/settings-section'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SourceSettingsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/model'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'

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
  const discard = () => setRows(saved())
  const addSecret = (
    <Button
      size='compact'
      icon='I074'
      onClick={() =>
        setRows((items) => [...items, { id: generateId(), name: '', value: '', saved: false }])
      }
    >
      Add secret
    </Button>
  )
  return (
    <SectionStack>
      <DetailHeader
        title='Generic Secrets'
        description='Organization secrets your sources can use'
        backLabel='Sources'
        onBack={() => requestSettingsLeave(() => router.push(href))}
      />
      <SettingsList
        title='Organization secrets'
        empty={
          rows.length === 0
            ? {
                title: 'No organization secrets',
                description: 'Store a value your sources can use',
                action: addSecret,
              }
            : undefined
        }
      >
        {rows.map((row) => (
          <SettingsRow key={row.id} label={row.saved ? row.name : 'New secret'}>
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
        <SettingsRow label='Add secret' description='Store a value your sources can use'>
          {addSecret}
        </SettingsRow>
      </SettingsList>
      <SettingsSaveBar
        dirty={dirty}
        saving={false}
        blockedReason={
          valid
            ? undefined
            : 'Name each secret with letters, digits and underscores, give a new one a value, and keep names unique'
        }
        onSave={() => {
          update((current) => ({ ...current, secrets: names }))
          setRows(rows.map((row) => ({ ...row, name: row.name.trim(), value: '', saved: true })))
        }}
        onDiscard={discard}
      />
    </SectionStack>
  )
}
