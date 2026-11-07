'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { useKnowledgeGraphs } from '@/platform/shared/knowledge-graphs'

export default function KnowledgeGraphsSection({ organization }: SettingsSectionProps) {
  const graphs = useKnowledgeGraphs(organization.organization.id)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  return (
    <>
      <SettingsSection title='Graphs'>
        {graphs.status === 'error' ? (
          <FailureNotice
            message={graphs.error ?? 'Failed to load knowledge graphs'}
            onRetry={graphs.retry}
          />
        ) : graphs.status === 'pending' ? null : (
          graphs.graphs.map((graph) => (
            <SettingsRow
              key={graph.key}
              leading={<Icon name='I004' />}
              label={graph.name}
              description={graph.description}
            >
              {graph.active ? (
                <StatusTag label='Active' intent='success' />
              ) : (
                <Button
                  size='compact'
                  disabled={graphs.selecting || creating}
                  onClick={() => graphs.makeActive(graph.id)}
                >
                  Make active
                </Button>
              )}
            </SettingsRow>
          ))
        )}
        <SettingsRow
          label='New knowledge graph'
          description='New chats use the active graph. Existing chats keep their original graph.'
        >
          <Button
            size='compact'
            icon='I074'
            disabled={graphs.status !== 'success' || graphs.selecting}
            onClick={() => {
              setName('')
              setCreating(true)
            }}
          >
            New graph
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title='New knowledge graph'
        confirmLabel={graphs.creating ? 'Creating…' : 'Create and activate'}
        confirmDisabled={!name.trim()}
        onConfirm={() => graphs.create(name.trim())}
      >
        <TextField
          label='Name'
          placeholder='e.g. Fresh exploration'
          hint='Creates an empty graph and makes it active for new chats. Your other graphs are kept.'
          maxLength={graphs.nameMaxLength}
          disabled={graphs.creating}
          value={name}
          onChange={setName}
        />
      </Modal>
    </>
  )
}
