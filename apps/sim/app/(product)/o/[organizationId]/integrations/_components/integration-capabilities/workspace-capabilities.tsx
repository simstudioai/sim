'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { TextAreaField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { getErrorMessage } from '@sim/utils/errors'
import { IntegrationTemplates } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/integration-capabilities'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/integration-capabilities.module.css'
import { isSkillNameConflictError, useCreateSkill, useSkills } from '@/platform/lib/data/skills'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'

type CatalogSkill = IntegrationCatalogEntry['skills'][number]

interface WorkspaceCapabilitiesProps {
  workspaceId: string
  skills: IntegrationCatalogEntry['skills']
  templates: IntegrationCatalogEntry['templates']
}

/**
 * An app's suggested skills and agent templates in one workspace, as legacy's workspace app page
 * offered them. A skill is added to the workspace through the Skills tab's own create operation,
 * and the workspace's skill list decides which already read Added.
 */
export function WorkspaceCapabilities({
  workspaceId,
  skills,
  templates,
}: WorkspaceCapabilitiesProps) {
  const existing = useSkills(workspaceId)
  const createSkill = useCreateSkill()
  const [adding, setAdding] = useState<{ skill: CatalogSkill; instructions: string } | null>(null)
  const listed = existing.isPlaceholderData ? undefined : existing.data
  const added = new Set((listed ?? []).map((skill) => skill.name))

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
                textMetadata={added.has(entry.name) ? 'Added' : undefined}
                disabled={!listed || added.has(entry.name)}
                onOpen={() => setAdding({ skill: entry, instructions: entry.content })}
              />
            ))}
          </ul>
        </section>
      )}
      <IntegrationTemplates templates={templates} />
      {adding && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setAdding(null)
          }}
          title={adding.skill.name}
          confirmLabel='Add to Skills'
          confirmDisabled={!adding.instructions.trim()}
          onConfirm={async () => {
            try {
              await createSkill.mutateAsync({
                workspaceId,
                skill: {
                  name: adding.skill.name,
                  description: adding.skill.description,
                  content: adding.instructions.trim(),
                },
              })
            } catch (error) {
              throw new Error(
                isSkillNameConflictError(error)
                  ? `"${adding.skill.name}" is already in this workspace`
                  : getErrorMessage(error, `Could not add "${adding.skill.name}". Try again.`)
              )
            }
          }}
        >
          <DetailsField label='Description'>{adding.skill.description}</DetailsField>
          <TextAreaField
            label='Instructions'
            placeholder='What should the agent do with this skill?'
            value={adding.instructions}
            onChange={(instructions) => setAdding({ ...adding, instructions })}
            defaultSize='large'
            required
          />
        </Modal>
      )}
    </>
  )
}
