'use client'

import { useState } from 'react'
import { useQueryStates } from 'nuqs'
import styles from '@/platform/app/(shell)/integrations/_components/integration-capabilities/integration-capabilities.module.css'
import { catalogParams } from '@/platform/app/(shell)/integrations/_components/integration-capabilities/search-params'
import {
  ActivityRow,
  CopyButton,
  Icon,
  Modal,
  ModalBody,
  Pagination,
  Stack,
  TextAreaField,
} from '@/platform/design-system/components'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'

type CatalogSkill = IntegrationCatalogEntry['skills'][number]
type CatalogTemplate = IntegrationCatalogEntry['templates'][number]

interface IntegrationCapabilitiesProps {
  catalog: IntegrationCatalogEntry
  addedSkills?: readonly string[]
  onAddSkill?: (skill: CatalogSkill) => void
}

const TEMPLATES_PER_PAGE = 8

export function IntegrationCapabilities({
  catalog,
  addedSkills = [],
  onAddSkill,
}: IntegrationCapabilitiesProps) {
  const [skill, setSkill] = useState<CatalogSkill | null>(null)
  const [template, setTemplate] = useState<CatalogTemplate | null>(null)
  const [view, setView] = useQueryStates(catalogParams)
  const templatePages = Math.ceil(catalog.templates.length / TEMPLATES_PER_PAGE)
  const templatePage = Math.max(1, Math.min(view['templates-page'], templatePages))
  const templates = catalog.templates.slice(
    (templatePage - 1) * TEMPLATES_PER_PAGE,
    templatePage * TEMPLATES_PER_PAGE
  )
  const installed = new Set(addedSkills)
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
      {catalog.templates.length > 0 && (
        <section className={styles.section} aria-label='Agent templates'>
          <h2 data-type='T093'>
            <CountedLabel label='Agent templates' count={catalog.templates.length} />
          </h2>
          <ul className={styles.links}>
            {templates.map((entry) => (
              <ActivityRow
                key={entry.title}
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
                onOpen={() => setTemplate(entry)}
              />
            ))}
          </ul>
          {templatePages > 1 && (
            <Pagination
              label='Template pages'
              page={templatePage}
              pageCount={templatePages}
              onPageChange={(page) => void setView({ 'templates-page': page })}
            />
          )}
        </section>
      )}
      {skill &&
        (onAddSkill ? (
          <Modal
            open
            title={skill.name}
            description={skill.description}
            confirmLabel={installed.has(skill.name) ? 'Added to Skills' : 'Add to Skills'}
            confirmDisabled={installed.has(skill.name)}
            onOpenChange={(open) => {
              if (!open) setSkill(null)
            }}
            onConfirm={() => onAddSkill(skill)}
          >
            <TextAreaField
              label='Instructions'
              placeholder='Skill instructions'
              value={skill.content}
              readOnly
            />
          </Modal>
        ) : (
          <OverlayDialog
            open
            title={skill.name}
            description={skill.description}
            onClose={() => setSkill(null)}
          >
            <ModalBody>
              <TextAreaField
                label='Instructions'
                placeholder='Skill instructions'
                value={skill.content}
                readOnly
              />
            </ModalBody>
          </OverlayDialog>
        ))}
      {template && (
        <OverlayDialog open title={template.title} onClose={() => setTemplate(null)}>
          <ModalBody>
            <TextAreaField
              label='Prompt'
              placeholder='Agent prompt'
              value={template.prompt}
              readOnly
            />
            <CopyButton label='Copy prompt' text={template.prompt} />
          </ModalBody>
        </OverlayDialog>
      )}
    </>
  )
}
