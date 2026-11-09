'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import {
  DirectoryBack,
  DirectoryHeading,
} from '@/app/(product)/_components/resource-directory/resource-directory'
import { SettingsLeaveGuard } from '@/app/(product)/_components/session-state/settings-leave-guard'
import { PeopleSentence } from '@/app/(product)/o/[organizationId]/integrations/_components/people-sentence/people-sentence'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/resource-details/resource-details.module.css'
import {
  ResourceAccessFields,
  ResourceFields,
  useResourceDraft,
} from '@/app/(product)/o/[organizationId]/integrations/_components/resource-fields'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import { resourceDetailParams } from '@/platform/lib/integrations/center-navigation'

interface ResourceDetailsProps {
  kind: 'skill' | 'mcp'
  resource?: Exclude<IntegrationResource, { kind: 'credential' }>
  data: IntegrationCenterData
  backHref: string
  onBack: () => void
  onSave: (resource: IntegrationResource) => void
  onDelete: (id: string) => void
}

export function ResourceDetails({
  kind,
  resource,
  data,
  backHref,
  onBack,
  onSave,
  onDelete,
}: ResourceDetailsProps) {
  const editor = useResourceDraft({ kind, data, resource })
  const [view, setView] = useQueryStates(resourceDetailParams)
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  const noun = kind === 'skill' ? 'skill' : 'MCP'
  const owner = resource?.owner ?? data.viewer
  const people = [
    owner,
    ...data.people.filter(
      (person) =>
        editor.draft.scope === 'shared' &&
        person.id !== owner.id &&
        editor.draft.people.includes(person.id)
    ),
  ]
  function discard() {
    editor.reset()
    setError(undefined)
  }
  const { guardBack } = useSettingsUnsavedGuard({ isDirty: editor.dirty, onDiscard: discard })
  return (
    <>
      <SettingsLeaveGuard />
      <DirectoryBack
        href={backHref}
        label={kind === 'skill' ? 'Back to Skills' : 'Back to MCPs'}
        onNavigate={(event) => {
          event.preventDefault()
          guardBack(onBack)
        }}
      />
      <DirectoryHeading
        title={resource?.name ?? (kind === 'skill' ? 'Create skill' : 'Connect MCP')}
        description={resource?.description}
        leading={<Icon name={kind === 'skill' ? 'I044' : 'I126'} />}
      />
      <form
        className={styles.form}
        aria-label={`${kind === 'skill' ? 'Skill' : 'MCP'} details`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          try {
            const next = editor.value()
            onSave(next)
            editor.setDraft({
              ...editor.draft,
              name: next.name,
              description: next.description,
              ...(next.kind === 'skill' ? { instructions: next.instructions } : { url: next.url }),
            })
            editor.setToken('')
            setError(undefined)
          } catch (failure) {
            setError(getErrorMessage(failure, 'Could not save this resource.'))
          }
        }}
      >
        <ContentTabs
          label={`${kind === 'skill' ? 'Skill' : 'MCP'} details`}
          current={view.resourceTab}
          onSelect={(resourceTab) => {
            if (resourceTab === 'details' || resourceTab === 'access') void setView({ resourceTab })
          }}
          actions={
            editor.editable ? (
              <>
                {resource && (
                  <Button
                    size='compact'
                    variant='quiet'
                    destructive
                    onClick={() => setDeleting(true)}
                  >{`Delete ${noun}`}</Button>
                )}
                {editor.dirty && (
                  <Button size='compact' variant='quiet' onClick={discard}>
                    Cancel
                  </Button>
                )}
                <Button
                  size='compact'
                  variant={resource ? 'quiet' : 'primary'}
                  submit
                  disabled={Boolean(resource && !editor.dirty)}
                >
                  {resource ? 'Save changes' : kind === 'skill' ? 'Create' : 'Connect'}
                </Button>
              </>
            ) : undefined
          }
          items={[
            {
              id: 'details',
              label: 'Details',
              content: (
                <div className={styles.fields}>
                  <ResourceFields kind={kind} editor={editor} />
                </div>
              ),
            },
            {
              id: 'access',
              label: 'Access',
              content: (
                <div className={styles.access}>
                  <PeopleSentence prefix='Made by' people={[owner]} />
                  <div className={styles.fields}>
                    <ResourceAccessFields editor={editor} data={data} resource={resource} />
                  </div>
                  <DataTable
                    title='People with access'
                    titleHidden
                    columns={[
                      { key: 'name', label: 'Name', kind: 'text', primary: true, width: 'regular' },
                      { key: 'email', label: 'Email', kind: 'text', showFrom: 'compact' },
                    ]}
                    rows={people.map((person) => ({
                      id: person.id,
                      values: { name: person.name, email: person.email },
                      cells: {
                        name: (
                          <TableLabel
                            leading={<Avatar name={person.name} src={person.src} size='inline' />}
                            compactDetail={person.email ?? '—'}
                          >
                            {person.name}
                          </TableLabel>
                        ),
                        email: <span className={styles.email}>{person.email ?? '—'}</span>,
                      },
                    }))}
                  />
                </div>
              ),
            },
          ]}
        />
        {error && (
          <p className={styles.error} data-type='T052' role='alert'>
            {error}
          </p>
        )}
      </form>
      {deleting && resource && (
        <Modal
          open
          title={`Delete ${resource.name}?`}
          description='This removes it from your integrations.'
          variant='confirm'
          confirmLabel={`Delete ${noun}`}
          destructive
          onOpenChange={(open) => {
            if (!open) setDeleting(false)
          }}
          onConfirm={() => {
            onDelete(resource.id)
            onBack()
          }}
        />
      )}
    </>
  )
}
