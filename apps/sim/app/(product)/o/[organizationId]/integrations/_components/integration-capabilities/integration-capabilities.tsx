'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import { Stack } from '@sim/emcn/stack'
import { useHomePrompt } from '@/app/(product)/_components/session/composer-host'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/integration-capabilities.module.css'
import { ResourceEditor } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-editor/resource-editor'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'

type CatalogSkill = IntegrationCatalogEntry['skills'][number]

interface IntegrationCapabilitiesProps {
  catalog: IntegrationCatalogEntry
  providerId: string
  data: IntegrationCenterData
  onSave: (resource: IntegrationResource) => void
  onRemove: (id: string) => void
}

export function IntegrationCapabilities({
  catalog,
  providerId,
  data,
  onSave,
  onRemove,
}: IntegrationCapabilitiesProps) {
  const [skill, setSkill] = useState<CatalogSkill | null>(null)
  const installed = new Map(
    data.resources.flatMap((resource) =>
      resource.kind === 'skill' && resource.source?.providerId === providerId
        ? [[resource.source.name, resource] as const]
        : []
    )
  )
  const selected = skill ? installed.get(skill.name) : undefined
  return (
    <>
      {catalog.skills.length > 0 && (
        <section className={styles.section} aria-label='Skills'>
          <h2 data-type='T093'>Skills</h2>
          <ul className={styles.links}>
            {catalog.skills.map((entry) => (
              <ActivityRow
                key={entry.name}
                leading={<Icon name='I044' />}
                title={entry.name}
                detail={entry.description}
                textMetadata={installed.has(entry.name) ? 'Added' : undefined}
                onOpen={() => setSkill(entry)}
              />
            ))}
          </ul>
        </section>
      )}
      <IntegrationTemplates templates={catalog.templates} />
      {skill && (
        <ResourceEditor
          key={selected?.id ?? skill.name}
          kind='skill'
          resource={selected}
          data={data}
          skillDefaults={{
            name: skill.name,
            description: skill.description,
            instructions: skill.content,
            source: { providerId, name: skill.name },
          }}
          createLabel='Add to Skills'
          deleteLabel='Remove from Skills'
          onSave={onSave}
          onClose={() => setSkill(null)}
          onDelete={selected ? () => onRemove(selected.id) : undefined}
        />
      )}
    </>
  )
}

interface IntegrationTemplatesProps {
  templates: IntegrationCatalogEntry['templates']
}

/** An app's agent templates; choosing one opens its full prompt in the Home draft. */
export function IntegrationTemplates({ templates }: IntegrationTemplatesProps) {
  const preparePrompt = useHomePrompt()
  if (!templates.length) return null
  return (
    <section className={styles.section} aria-label='Agent templates'>
      <h2 data-type='T093'>
        <CountedLabel label='Agent templates' count={templates.length} />
      </h2>
      <ul className={styles.links}>
        {templates.map((entry) => (
          <ActivityRow
            key={`${entry.title}:${entry.prompt}`}
            title={entry.title}
            detail={entry.prompt}
            leading={
              <Stack
                label='Integrations used'
                items={entry.integrations.map((integration) => ({
                  id: integration.id,
                  label: integration.name,
                  content: <Icon providerId={integration.id} label={integration.name} />,
                }))}
              />
            }
            disabled={!preparePrompt}
            onOpen={() => preparePrompt?.(entry.prompt)}
          />
        ))}
      </ul>
    </section>
  )
}
