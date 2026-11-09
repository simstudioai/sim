'use client'

import { useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import {
  DirectoryBack,
  DirectoryHeading,
} from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import { SettingsLeaveGuard } from '@/platform/app/(shell)/_components/session-state/settings-leave-guard'
import { PeopleSentence } from '@/platform/app/(shell)/integrations/_components/people-sentence/people-sentence'
import { QueryFailure } from '@/platform/app/(shell)/integrations/_components/query-failure/query-failure'
import styles from '@/platform/app/(shell)/integrations/_components/skill-details/skill-details.module.css'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  isSkillNameConflictError,
  type ParsedSkill,
  parseSkillMarkdown,
  readSkillFile,
  SKILL_CONTENT_PLACEHOLDER,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_DESCRIPTION_PLACEHOLDER,
  SKILL_IMPORT_ACCEPT,
  SKILL_NAME_HINT,
  SKILL_NAME_PLACEHOLDER,
  type SkillDefinition,
  useCreateSkill,
  useDeleteSkill,
  useRemoveSkillMember,
  useSkillMembers,
  useSkills,
  useUpdateSkill,
  useUpsertSkillMember,
  useWorkspacePermissionsQuery,
  validateSkillName,
} from '@/platform/lib/data/skills'
import { resourceDetailParams } from '@/platform/lib/integrations/center-navigation'
import { toast } from '@/platform/shared/toast'

type SkillDraft = Pick<ParsedSkill, 'name' | 'description' | 'content'>
type SkillErrors = Partial<Record<keyof SkillDraft, string>>

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', content: '' }

function draftOf(skill: SkillDefinition): SkillDraft {
  return { name: skill.name, description: skill.description, content: skill.content }
}

function validate(draft: SkillDraft): SkillErrors {
  const errors: SkillErrors = {}
  const nameError = validateSkillName(draft.name)
  if (nameError) errors.name = nameError
  if (!draft.description.trim()) errors.description = 'Description is required'
  if (!draft.content.trim()) errors.content = 'Content is required'
  return errors
}

interface SkillDetailsProps {
  /** The workspace the skill belongs to; absent while the viewer's workspaces load. */
  workspaceId?: string
  /** The open skill, or `null` for a new one. */
  skillId: string | null
  backHref: string
  onBack: () => void
  onCreated: (skillId: string) => void
}

/**
 * A workspace skill's details and editors, or a new skill. Editors change its content and roster;
 * everyone else in the workspace reads it, and built-in skills are read-only for all.
 */
export function SkillDetails({
  workspaceId,
  skillId,
  backHref,
  onBack,
  onCreated,
}: SkillDetailsProps) {
  const skills = useSkills(workspaceId ?? '')
  const create = useCreateSkill()
  const update = useUpdateSkill()
  const remove = useDeleteSkill()
  const [view, setView] = useQueryStates(resourceDetailParams)
  const listed = skills.isPlaceholderData ? undefined : skills.data
  const skill = skillId ? listed?.find((item) => item.id === skillId) : undefined
  const builtin = Boolean(skill?.readOnly)
  const editable = skillId === null || (Boolean(skill?.canEdit) && !builtin)
  const saved = skill ? draftOf(skill) : EMPTY_DRAFT
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [seededId, setSeededId] = useState<string | null>(null)
  if (skill && seededId !== skill.id) {
    setSeededId(skill.id)
    setDraft(draftOf(skill))
  }
  const [errors, setErrors] = useState<SkillErrors>({})
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty =
    editable &&
    (draft.name !== saved.name ||
      draft.description !== saved.description ||
      draft.content !== saved.content)
  const pending = create.isPending || update.isPending

  function discard() {
    setDraft(saved)
    setErrors({})
  }
  const { guardBack } = useSettingsUnsavedGuard({ isDirty: dirty, onDiscard: discard })

  function edit(field: keyof SkillDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  /** A full SKILL.md in Content fills every field, as pasting one does in legacy. */
  function editContent(value: string) {
    const parsed = parseSkillMarkdown(value)
    if (!parsed.nameFromFrontmatter) return edit('content', value)
    setDraft({ name: parsed.name, description: parsed.description, content: parsed.content })
    setErrors({})
  }

  async function importFile(file: File) {
    setImporting(true)
    try {
      const parsed = await readSkillFile(file)
      setDraft({ name: parsed.name, description: parsed.description, content: parsed.content })
      setErrors({})
    } catch (error) {
      toast.error("Couldn't import skill", {
        description: getErrorMessage(error, 'Please try a .md or .zip file.'),
      })
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    if (!workspaceId || !editable || !dirty || pending) return
    const found = validate(draft)
    if (Object.keys(found).length) return setErrors(found)
    try {
      if (!skill) {
        const { created } = await create.mutateAsync({ workspaceId, skill: draft })
        toast.success(`Created "${draft.name}"`)
        if (created) onCreated(created.id)
        else onBack()
        return
      }
      await update.mutateAsync({
        workspaceId,
        skillId: skill.id,
        updates: {
          ...(draft.name !== skill.name ? { name: draft.name } : {}),
          ...(draft.description !== skill.description ? { description: draft.description } : {}),
          ...(draft.content !== skill.content ? { content: draft.content } : {}),
        },
      })
      setErrors({})
      toast.success(`Saved "${draft.name}"`)
    } catch (error) {
      if (isSkillNameConflictError(error)) {
        setErrors({ name: getErrorMessage(error, 'This skill name is already taken.') })
      } else {
        toast.error(skill ? "Couldn't save skill" : "Couldn't create skill", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
    }
  }

  const back = (
    <DirectoryBack
      href={backHref}
      label='Back to Skills'
      onNavigate={(event) => {
        event.preventDefault()
        guardBack(onBack)
      }}
    />
  )
  if (skills.error) {
    return (
      <>
        {back}
        <QueryFailure message='Could not load skills' query={skills} />
      </>
    )
  }
  if (skillId && !skill) {
    const removed = remove.isPending || remove.isSuccess
    return (
      <>
        {back}
        {listed && !removed && <EmptyState title='This skill is no longer available.' />}
      </>
    )
  }

  const lockReason = editable
    ? undefined
    : builtin
      ? 'Built-in skills are read-only'
      : 'You need to be a skill editor to edit this skill'
  const details = (
    <div className={styles.fields}>
      <TextField
        label='Name'
        name='name'
        placeholder={SKILL_NAME_PLACEHOLDER}
        hint={lockReason ?? SKILL_NAME_HINT}
        error={errors.name}
        value={draft.name}
        onChange={(value) => edit('name', value)}
        viewOnly={!editable}
        required
        maxLength={64}
      />
      <TextAreaField
        label='Description'
        name='description'
        placeholder={SKILL_DESCRIPTION_PLACEHOLDER}
        error={errors.description}
        value={draft.description}
        onChange={(value) => edit('description', value)}
        viewOnly={!editable}
        required
        maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
      />
      <TextAreaField
        label='Instructions'
        name='content'
        placeholder={SKILL_CONTENT_PLACEHOLDER}
        defaultSize='large'
        error={errors.content}
        value={draft.content}
        onChange={editContent}
        viewOnly={!editable}
        required
      />
    </div>
  )

  return (
    <>
      <SettingsLeaveGuard />
      {back}
      <DirectoryHeading
        title={skill?.name ?? 'Create skill'}
        description={
          skill
            ? builtin
              ? 'Built-in skill'
              : skill.description
            : 'Write a skill, or import an existing SKILL.md'
        }
        leading={<Icon name='I044' />}
      />
      <form
        className={styles.form}
        aria-label='Skill details'
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <ContentTabs
          label='Skill details'
          current={skill && !builtin ? view.resourceTab : 'details'}
          onSelect={(resourceTab) => {
            if (resourceTab === 'details' || resourceTab === 'access') void setView({ resourceTab })
          }}
          actions={
            editable ? (
              <>
                {skill ? (
                  <Button
                    size='compact'
                    variant='quiet'
                    destructive
                    disabled={remove.isPending}
                    onClick={() => setDeleting(true)}
                  >
                    Delete skill
                  </Button>
                ) : (
                  <Button
                    size='compact'
                    variant='quiet'
                    disabled={importing || pending}
                    onClick={() => fileInput.current?.click()}
                  >
                    {importing ? 'Importing…' : 'Import'}
                  </Button>
                )}
                {dirty && (
                  <Button size='compact' variant='quiet' disabled={pending} onClick={discard}>
                    Cancel
                  </Button>
                )}
                <Button
                  size='compact'
                  variant={skill ? 'quiet' : 'primary'}
                  submit
                  disabled={!dirty || pending || !workspaceId}
                >
                  {skill
                    ? update.isPending
                      ? 'Saving…'
                      : 'Save changes'
                    : create.isPending
                      ? 'Creating…'
                      : 'Create'}
                </Button>
              </>
            ) : undefined
          }
          items={
            skill && workspaceId && !builtin
              ? [
                  { id: 'details', label: 'Details', content: details },
                  {
                    id: 'access',
                    label: 'Access',
                    content: (
                      <SkillEditors workspaceId={workspaceId} skill={skill} canEdit={editable} />
                    ),
                  },
                ]
              : [{ id: 'details', label: 'Details', content: details }]
          }
        />
      </form>
      <input
        ref={fileInput}
        type='file'
        accept={SKILL_IMPORT_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importFile(file)
        }}
      />
      {deleting && skill && workspaceId && (
        <Modal
          open
          title={`Delete ${skill.name}?`}
          description='This action cannot be undone.'
          variant='confirm'
          confirmLabel='Delete skill'
          destructive
          onOpenChange={(open) => {
            if (!open) setDeleting(false)
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync({ workspaceId, skillId: skill.id })
            } catch (error) {
              toast.error("Couldn't delete skill", {
                description: getErrorMessage(error, 'Please try again in a moment.'),
              })
              throw error
            }
            onBack()
          }}
        />
      )}
    </>
  )
}

interface SkillEditorsProps {
  workspaceId: string
  skill: SkillDefinition
  canEdit: boolean
}

/**
 * Who can edit the skill: workspace admins, always, and the people editors add. Everyone in the
 * workspace can already use it, so this roster gates editing only.
 */
function SkillEditors({ workspaceId, skill, canEdit }: SkillEditorsProps) {
  const editors = useSkillMembers(skill.id)
  const members = useWorkspacePermissionsQuery(workspaceId)
  const addEditor = useUpsertSkillMember()
  const removeEditor = useRemoveSkillMember()
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const roster = editors.data ?? []
  const people = members.data?.users ?? []
  const creator = people.find((person) => person.userId === skill.userId)
  const onRoster = new Set(roster.map((editor) => editor.userId))
  const available = people.filter((person) => !onRoster.has(person.userId))

  async function add() {
    const targets = selected.filter((userId) => !onRoster.has(userId))
    if (!targets.length) return
    setAdding(true)
    const results = await Promise.allSettled(
      targets.map((userId) => addEditor.mutateAsync({ skillId: skill.id, workspaceId, userId }))
    )
    setAdding(false)
    const failed = targets.filter((_, index) => results[index].status === 'rejected')
    setSelected(failed)
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (!rejection) return
    const reason = getErrorMessage(rejection.reason, 'Please try again in a moment.')
    toast.error(
      failed.length === targets.length
        ? "Couldn't add people"
        : `Couldn't add ${failed.length} of ${targets.length} people`,
      { description: reason }
    )
  }

  async function removeFromRoster(userId: string) {
    try {
      await removeEditor.mutateAsync({ skillId: skill.id, workspaceId, userId })
    } catch (error) {
      toast.error("Couldn't remove editor", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  return (
    <div className={styles.access}>
      {creator && (
        <PeopleSentence
          prefix='Made by'
          people={[
            {
              id: creator.userId,
              name: creator.name ?? creator.email,
              email: creator.email,
              src: creator.image ?? undefined,
            },
          ]}
        />
      )}
      {canEdit && (
        <div className={styles.invite}>
          <MultiSelect
            label='People'
            placeholder='Choose people…'
            searchLabel='Search people to add'
            options={available.map((person) => ({
              value: person.userId,
              label: person.name ?? person.email,
            }))}
            value={selected}
            onValueChange={setSelected}
            disabled={!available.length}
            disabledReason='Everyone in this workspace can already edit this skill.'
          />
          <Button
            size='compact'
            variant='secondary'
            disabled={!selected.length || adding}
            onClick={() => void add()}
          >
            {adding ? 'Adding…' : 'Add people'}
          </Button>
        </div>
      )}
      {editors.error ? (
        <QueryFailure
          message="Couldn't load editors. You may no longer have access to this skill."
          query={editors}
        />
      ) : (
        editors.data && (
          <DataTable
            title='Skill editors'
            titleHidden
            rowActions={canEdit}
            columns={[
              { key: 'name', label: 'Name', kind: 'text', primary: true, width: 'regular' },
              { key: 'email', label: 'Email', kind: 'text', showFrom: 'compact' },
            ]}
            rows={roster.map((editor) => {
              const name = editor.userName ?? editor.userEmail ?? ''
              return {
                id: editor.id,
                values: { name, email: editor.userEmail ?? undefined },
                cells: {
                  name: (
                    <TableLabel
                      leading={
                        <Avatar name={name} src={editor.userImage ?? undefined} size='inline' />
                      }
                      compactDetail={editor.userEmail ?? '—'}
                    >
                      {name}
                    </TableLabel>
                  ),
                  email: <span className={styles.email}>{editor.userEmail ?? '—'}</span>,
                },
                action: canEdit ? (
                  <ActionMenu
                    label={`Manage ${name}`}
                    icon='I108'
                    triggerSize='row'
                    tooltip={false}
                    align='end'
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove',
                        destructive: true,
                        disabled: editor.isWorkspaceAdmin,
                        disabledReason: 'Workspace admins are automatically skill editors',
                        onSelect: () => void removeFromRoster(editor.userId),
                      },
                    ]}
                  />
                ) : undefined,
              }
            })}
          />
        )
      )}
    </div>
  )
}
