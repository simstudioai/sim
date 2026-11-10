'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { getErrorMessage } from '@sim/utils/errors'
import { type SkillDraft, SkillFields } from '@/app/(product)/_components/skill-fields/skill-fields'
import { IntegrationTemplates } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/integration-capabilities'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/integration-capabilities.module.css'
import {
  isSkillNameConflictError,
  type SkillDefinition,
  useCreateSkill,
  useDeleteSkill,
  useSkills,
  useUpdateSkill,
} from '@/platform/lib/data/skills'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'

type CatalogSkill = IntegrationCatalogEntry['skills'][number]

interface WorkspaceCapabilitiesProps {
  workspaceId: string
  skills: IntegrationCatalogEntry['skills']
  templates: IntegrationCatalogEntry['templates']
}

/**
 * An app's suggested skills and agent templates in one workspace, as legacy's workspace app page
 * offered them. A suggestion is added to the workspace through the Skills tab's own create
 * operation; one already added, by name, opens for editing or removal.
 */
export function WorkspaceCapabilities({
  workspaceId,
  skills,
  templates,
}: WorkspaceCapabilitiesProps) {
  const existing = useSkills(workspaceId)
  const [open, setOpen] = useState<{ skill: CatalogSkill; installed?: SkillDefinition } | null>(
    null
  )
  const listed = existing.isPlaceholderData ? undefined : existing.data
  const installed = new Map((listed ?? []).map((skill) => [skill.name, skill]))

  return (
    <>
      {skills.length > 0 && (
        <section className={styles.section} aria-label='Skills'>
          <h2 data-type='T093'>Skills</h2>
          <ul className={styles.links}>
            {skills.map((entry) => (
              <ActivityRow
                key={entry.name}
                leading={<Icon name='I044' />}
                title={entry.name}
                detail={entry.description}
                textMetadata={installed.has(entry.name) ? 'Added' : undefined}
                onOpen={() => setOpen({ skill: entry, installed: installed.get(entry.name) })}
              />
            ))}
          </ul>
        </section>
      )}
      <IntegrationTemplates templates={templates} />
      {open && (
        <SuggestedSkillEditor
          key={open.installed?.id ?? open.skill.name}
          workspaceId={workspaceId}
          skill={open.skill}
          installed={open.installed}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

interface SuggestedSkillEditorProps {
  workspaceId: string
  skill: CatalogSkill
  /** The workspace's copy of the suggestion, which the editor saves to or removes. */
  installed?: SkillDefinition
  onClose: () => void
}

/** A suggested skill's editable fields before adding it, or its added copy's. */
function SuggestedSkillEditor({
  workspaceId,
  skill,
  installed,
  onClose,
}: SuggestedSkillEditorProps) {
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const saved: SkillDraft = installed
    ? { name: installed.name, description: installed.description, content: installed.content }
    : { name: skill.name, description: skill.description, content: skill.content }
  const [draft, setDraft] = useState(saved)
  const [removing, setRemoving] = useState(false)
  const editable = !installed || (installed.canEdit && !installed.readOnly)
  const dirty =
    draft.name !== saved.name ||
    draft.description !== saved.description ||
    draft.content !== saved.content
  const complete = Boolean(draft.name.trim() && draft.description.trim() && draft.content.trim())

  async function save() {
    const next = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      content: draft.content.trim(),
    }
    try {
      if (!installed) {
        await createSkill.mutateAsync({ workspaceId, skill: next })
        return
      }
      await updateSkill.mutateAsync({
        workspaceId,
        skillId: installed.id,
        updates: {
          ...(next.name !== installed.name ? { name: next.name } : {}),
          ...(next.description !== installed.description ? { description: next.description } : {}),
          ...(next.content !== installed.content ? { content: next.content } : {}),
        },
      })
    } catch (error) {
      throw new Error(
        isSkillNameConflictError(error)
          ? `"${next.name}" is already in this workspace`
          : getErrorMessage(error, `Could not save "${next.name}". Try again.`)
      )
    }
  }

  return (
    <>
      <Modal
        open
        title={skill.name}
        confirmLabel={installed ? 'Save changes' : 'Add to Skills'}
        confirmDisabled={!editable || !complete || Boolean(installed && !dirty)}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        onConfirm={save}
        footerStartAction={
          installed && editable
            ? {
                label: 'Remove from Skills',
                variant: 'quiet',
                destructive: true,
                onClick: () => setRemoving(true),
              }
            : undefined
        }
      >
        <SkillFields draft={draft} onEdit={setDraft} viewOnly={!editable} />
      </Modal>
      {removing && installed && (
        <Modal
          open
          title='Remove from Skills?'
          description={`This removes ${installed.name} from your integrations.`}
          variant='confirm'
          destructive
          confirmLabel='Remove from Skills'
          onOpenChange={(next) => {
            if (!next) setRemoving(false)
          }}
          onConfirm={async () => {
            try {
              await deleteSkill.mutateAsync({ workspaceId, skillId: installed.id })
            } catch (error) {
              throw new Error(getErrorMessage(error, `Could not remove "${installed.name}".`))
            }
            onClose()
          }}
        />
      )}
    </>
  )
}
