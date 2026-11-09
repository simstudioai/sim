'use client'

import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import {
  ActionRow,
  FieldStack,
  Muted,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { AdminConsole, ImportInputs } from '@/platform/lib/data/admin-model'

interface WorkflowImportProps {
  importer: AdminConsole['importer']
  inputs: ImportInputs
  onChange: (next: ImportInputs) => void
  onImported: () => void
}

export function WorkflowImport({ importer, inputs, onChange, onImported }: WorkflowImportProps) {
  const { workflow, target } = inputs
  const locked = importer.pending || importer.blocked
  return (
    <SettingsSection title='Import workflow'>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (locked || !workflow.trim() || !target.trim()) return
          void importer.submit(inputs).then((imported) => {
            if (imported) onImported()
          })
        }}
      >
        <FieldStack>
          <Muted>Import a workflow and its copilot chats into a target workspace.</Muted>
          <TextField
            label='Source workflow ID'
            placeholder={importer.placeholders.workflow}
            value={workflow}
            disabled={locked}
            onChange={(value) => onChange({ ...inputs, workflow: value })}
            required
          />
          <TextField
            label='Target workspace ID'
            placeholder={importer.placeholders.target}
            value={target}
            disabled={locked}
            onChange={(value) => onChange({ ...inputs, target: value })}
            required
          />
          <ActionRow>
            <Button
              submit
              size='compact'
              variant='primary'
              disabled={locked || !workflow.trim() || !target.trim()}
            >
              {importer.pending ? 'Importing…' : 'Import'}
            </Button>
          </ActionRow>
          {importer.notice && (
            <InlineNotice
              intent={importer.notice.failed ? 'danger' : 'success'}
              message={importer.notice.message}
            />
          )}
        </FieldStack>
      </form>
    </SettingsSection>
  )
}
