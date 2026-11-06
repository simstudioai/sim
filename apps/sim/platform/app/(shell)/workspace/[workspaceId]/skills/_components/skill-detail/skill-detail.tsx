'use client'

import { type ClipboardEvent, useId, useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { MarkdownContent } from '@/platform/app/(shell)/_components/markdown-content/markdown-content'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import type {
  SkillFields,
  SkillsData,
  WorkspaceSkill,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/skills/_components/skill-detail/skill-detail.module.css'
import { SkillEditors } from '@/platform/app/(shell)/workspace/[workspaceId]/skills/_components/skill-detail/skill-editors'
import {
  Button,
  FieldFrame,
  FileField,
  Icon,
  Modal,
  SegmentedControl,
  TextArea,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { skillFile } from '@/platform/lib/data/skill-drafts'

const EMPTY: SkillFields = { name: '', description: '', content: '' }

interface SkillDetailProps {
  data: SkillsData
  skill?: WorkspaceSkill
  skills: WorkspaceSkill[]
  onSave: (skill: WorkspaceSkill) => void
  onDelete: (id: string) => void
  href: (id?: string) => string
}

export function SkillDetail({ data, skill, skills, onSave, onDelete, href }: SkillDetailProps) {
  const router = useRouter()
  const { notify } = usePlatformNotices()
  const formId = useId()
  const contentId = useId()
  const [contentMode, setContentMode] = useState<'edit' | 'preview'>('edit')
  const saved = skill ?? EMPTY
  const [draft, setDraft] = useState<SkillFields>(saved)
  const [submitted, setSubmitted] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'delete' | 'share' | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const editable = skill ? skill.access === 'editor' : data.canCreate
  const dirty =
    editable &&
    (draft.name !== saved.name ||
      draft.description !== saved.description ||
      draft.content !== saved.content)

  function discard() {
    setDraft(saved)
    setSubmitted(false)
  }
  useSettingsUnsavedGuard({ isDirty: dirty, onDiscard: discard })
  const errors = {
    name:
      skillFile.nameError(draft.name) ??
      (skills.some((item) => item.id !== skill?.id && item.name === draft.name)
        ? 'This skill name is already in use.'
        : undefined),
    description: draft.description.trim() ? undefined : 'Description is required.',
    content: draft.content.trim() ? undefined : 'Content is required.',
  }

  function save() {
    if (!editable || !dirty) return
    setSubmitted(true)
    if (errors.name || errors.description || errors.content) {
      if (errors.content) setContentMode('edit')
      return
    }
    const next: WorkspaceSkill = {
      ...draft,
      id: skill?.id ?? generateId(),
      access: 'editor',
      editorIds: skill?.editorIds ?? [data.viewerId],
    }
    onSave(next)
    setSubmitted(false)
    notify({
      id: generateId(),
      title: skill ? 'Skill saved' : 'Skill created',
      description: next.name,
      icon: 'I044',
    })
    if (!skill) router.replace(href(next.id))
  }

  function applyImported({ name, description, content }: SkillFields) {
    setDraft({ name, description, content })
    setSubmitted(false)
  }

  function paste(event: ClipboardEvent) {
    if (!editable) return
    const parsed = skillFile.parse(event.clipboardData.getData('text/plain'))
    if (!parsed.nameFromFrontmatter) return
    event.preventDefault()
    applyImported(parsed)
  }

  return (
    <>
      <DirectoryHeading
        leading={<Icon name='I044' />}
        title={skill?.name ?? 'New skill'}
        description={
          skill?.access === 'built-in'
            ? 'Built-in skill'
            : (skill?.description ?? 'Write instructions or import a SKILL.md file.')
        }
        action={
          editable && (
            <div className={styles.actions}>
              {skill ? (
                <>
                  <Button size='compact' variant='quiet' onClick={() => setDialog('share')}>
                    Share
                  </Button>
                  <Button size='compact' variant='quiet' onClick={() => setDialog('delete')}>
                    Delete
                  </Button>
                </>
              ) : (
                <Button size='compact' icon='I117' onClick={() => setDialog('import')}>
                  Import
                </Button>
              )}
              {dirty && (
                <Button size='compact' variant='quiet' onClick={discard}>
                  Discard
                </Button>
              )}
              <Button
                size='compact'
                variant='primary'
                render={<button form={formId} />}
                submit
                disabled={!dirty}
              >
                {skill ? 'Save' : 'Create'}
              </Button>
            </div>
          )
        }
      />
      <form
        id={formId}
        className={styles.fields}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <TextField
          label='Name'
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
          readOnly={!editable}
          hint={
            editable
              ? 'Use lowercase letters, numbers and hyphens.'
              : skill?.access === 'built-in'
                ? 'Built-in skills are read-only.'
                : 'Only skill editors can make changes.'
          }
          placeholder='my-skill-name'
          required
          error={submitted ? errors.name : undefined}
        />
        <TextAreaField
          label='Description'
          value={draft.description}
          onChange={(description) => setDraft({ ...draft, description })}
          readOnly={!editable}
          maxLength={1024}
          required
          placeholder='When should an agent use this skill?'
          error={submitted ? errors.description : undefined}
        />
        <div className={styles.content} onPaste={paste}>
          {editable && (
            <SegmentedControl
              label='Content view'
              value={contentMode}
              options={[
                { value: 'edit', label: 'Edit' },
                { value: 'preview', label: 'Preview' },
              ]}
              onSelect={setContentMode}
            />
          )}
          {editable && contentMode === 'edit' ? (
            <FieldFrame
              id={contentId}
              label='Content'
              error={submitted ? errors.content : undefined}
            >
              <TextArea
                id={contentId}
                label='Content'
                value={draft.content}
                onChange={(content) => setDraft({ ...draft, content })}
                required
                defaultSize='large'
                placeholder='Write skill instructions in Markdown…'
                invalid={submitted && !!errors.content}
                describedBy={submitted && errors.content ? `${contentId}-error` : undefined}
              />
            </FieldFrame>
          ) : (
            <FieldFrame label='Content' error={submitted ? errors.content : undefined}>
              <MarkdownContent text={draft.content} />
            </FieldFrame>
          )}
        </div>
      </form>
      {skill && skill.access !== 'built-in' && (
        <SkillEditors
          data={data}
          skill={skill}
          onSave={onSave}
          sharing={dialog === 'share'}
          onClose={() => setDialog(null)}
        />
      )}
      {editable && (
        <>
          {skill ? (
            <Modal
              title='Delete skill'
              variant='confirm'
              destructive
              description={`Delete ${skill.name} from this workspace?`}
              confirmLabel='Delete'
              open={dialog === 'delete'}
              onOpenChange={() => setDialog(null)}
              onConfirm={() => {
                onDelete(skill.id)
                router.replace(href())
              }}
            />
          ) : (
            <Modal
              title='Import skill'
              confirmLabel='Import'
              open={dialog === 'import'}
              onOpenChange={() => {
                setDialog(null)
                setFile(null)
              }}
              confirmDisabled={!file}
              onConfirm={async () => {
                if (file) applyImported(await skillFile.read(file))
              }}
            >
              <FileField
                label='Skill file'
                accept={skillFile.accept}
                hint='Choose a Markdown file or ZIP containing SKILL.md.'
                onFileChange={setFile}
                selection={file ? { name: file.name } : undefined}
                onClear={() => setFile(null)}
              />
            </Modal>
          )}
        </>
      )}
    </>
  )
}
