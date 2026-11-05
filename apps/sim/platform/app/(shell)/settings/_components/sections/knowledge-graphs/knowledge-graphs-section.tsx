'use client'

import { useState } from 'react'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import {
  Button,
  FailureNotice,
  Modal,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useKnowledgeGraphs } from '@/platform/lib/data/knowledge-graphs'

const TITLE = 'Graphs'

export default function KnowledgeGraphsSection({ organization }: SettingsSectionProps) {
  const graphs = useKnowledgeGraphs(organization.organization.id)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  return (
    <>
      <div>
        <Button
          icon='I074'
          disabled={graphs.status !== 'success' || graphs.selecting}
          onClick={() => {
            setName('')
            setCreating(true)
          }}
        >
          New graph
        </Button>
      </div>
      {graphs.status === 'error' ? (
        <FailureNotice
          message={graphs.error ?? 'Failed to load knowledge graphs'}
          onRetry={graphs.retry}
        />
      ) : graphs.status === 'pending' ? (
        <SectionSkeleton title={TITLE} rows={2} />
      ) : (
        <SettingsSection title={TITLE}>
          {graphs.graphs.map((graph) => (
            <SettingsRow key={graph.key} label={graph.name} description={graph.description}>
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
          ))}
        </SettingsSection>
      )}
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title='New knowledge graph'
        confirmLabel='Create and activate'
        confirmDisabled={!name.trim()}
        onConfirm={() => graphs.create(name.trim())}
      >
        <TextField
          label='Name'
          placeholder='e.g. Fresh exploration'
          hint='Creates an empty graph and makes it active for new chats. Your other graphs are kept.'
          maxLength={graphs.nameMaxLength}
          value={name}
          onChange={setName}
        />
      </Modal>
    </>
  )
}
