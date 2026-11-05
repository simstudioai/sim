'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import {
  ActionRow,
  FieldStack,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { AdminExample } from '@/platform/app/(shell)/settings/_components/sections/admin/model'
import { Button, InlineNotice, TextField } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

export interface ImportInputs {
  workflow: string
  target: string
}

interface WorkflowImportProps {
  example: AdminExample | null
  onEdit: (next: AdminExample) => void
  manageHref: string
  inputs: ImportInputs
  onChange: (next: ImportInputs) => void
}

export function WorkflowImport({
  example,
  onEdit,
  manageHref,
  inputs,
  onChange,
}: WorkflowImportProps) {
  const { workflow, target } = inputs
  const [notice, setNotice] = useState<{ message: string; failed?: boolean }>()
  function submit() {
    if (!example) return
    const source = example.workflows.find((item) => item.id === workflow.trim())
    if (!source || !example.workspaces.includes(target.trim())) {
      setNotice({
        message: source ? 'Target workspace not found.' : 'Source workflow not found.',
        failed: true,
      })
      return
    }
    const copy = { ...source, id: generateId(), workspaceId: target.trim() }
    onEdit({ ...example, workflows: [...example.workflows, copy] })
    setNotice({
      message: `Workflow imported successfully (new ID: ${copy.id}, ${source.chats} copilot chats imported).`,
    })
    onChange({ workflow: '', target: '' })
  }
  return (
    <SettingsSection title='Import workflow'>
      {example ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <FieldStack>
            <Muted>Import a workflow and its copilot chats into a target workspace.</Muted>
            <TextField
              label='Source workflow ID'
              placeholder={example.workflows[0]?.id}
              value={workflow}
              onChange={(value) => {
                onChange({ ...inputs, workflow: value })
                setNotice(undefined)
              }}
              required
            />
            <TextField
              label='Target workspace ID'
              placeholder={example.workspaces[1]}
              value={target}
              onChange={(value) => {
                onChange({ ...inputs, target: value })
                setNotice(undefined)
              }}
              required
            />
            <ActionRow>
              <Button
                submit
                size='compact'
                variant='primary'
                disabled={!workflow.trim() || !target.trim()}
              >
                Import
              </Button>
            </ActionRow>
            {notice && (
              <InlineNotice
                intent={notice.failed ? 'danger' : 'success'}
                message={notice.message}
              />
            )}
          </FieldStack>
        </form>
      ) : (
        <SettingsRow label='Import a workflow and its copilot chats into a target workspace.'>
          <Button size='compact' render={<a href={manageHref}>Open workflow importer</a>}>
            Open workflow importer
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  )
}
