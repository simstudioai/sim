'use client'

import { useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { FailureNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import {
  DirectoryBack,
  DirectoryHeading,
} from '@/app/(product)/_components/resource-directory/resource-directory'
import {
  type SkillDraft,
  type SkillErrors,
  SkillFields,
  validateSkillDraft,
} from '@/app/(product)/_components/skill-fields/skill-fields'
import { PeopleSentence } from '@/app/(product)/o/[organizationId]/integrations/_components/people-sentence/people-sentence'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/skill-details/skill-details.module.css'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  isSkillNameConflictError,
  readSkillFile,
  SKILL_IMPORT_ACCEPT,
  type SkillDefinition,
  useCreateSkill,
  useDeleteSkill,
  useRemoveSkillMember,
  useSkillMembers,
  useSkills,
  useUpdateSkill,
  useUpsertSkillMember,
  useWorkspacePermissionsQuery,
} from '@/platform/lib/data/skills'
import { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'
import { resourceDetailParams } from '@/platform/lib/integrations/center-navigation'

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', content: '' }

function draftOf(skill: SkillDefinition): SkillDraft {
  return { name: skill.name, description: skill.description, content: skill.content }
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
  const { canEdit: canWrite } = useWorkspaceUserPermissions(workspaceId ?? '')
  const editable = skillId === null ? canWrite : Boolean(skill?.canEdit) && !builtin
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

  function edit(next: SkillDraft, changed: readonly (keyof SkillDraft)[]) {
    setDraft(next)
    setErrors((current) => {
      const remaining = { ...current }
      for (const field of changed) delete remaining[field]
      return remaining
    })
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
    const found = validateSkillDraft(draft)
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
      label='Skills'
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
        <FailureNotice
          message='Could not load skills'
          retrying={skills.isFetching}
          onRetry={() => void skills.refetch()}
        />
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
      : skill
        ? 'You need to be a skill editor to edit this skill'
        : 'You need write access to this workspace to create a skill'
  const details = (
    <div className={styles.fields}>
      <SkillFields
        draft={draft}
        errors={errors}
        onEdit={edit}
        viewOnly={!editable}
        readOnlyReason={lockReason}
      />
    </div>
  )

  return (
    <>
      {back}
      <DirectoryHeading
        title={skill?.name ?? 'Create skill'}
        description={skill?.description}
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
                    Import
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
                  {skill ? 'Save' : 'Create skill'}
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
        <ConfirmDialog
          target={deleting}
          onClose={() => setDeleting(false)}
          title='Delete skill'
          description={`This removes ${skill.name} from your integrations.`}
          confirmLabel='Delete'
          pendingLabel='Deleting…'
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
        <FailureNotice
          message="Couldn't load editors. You may no longer have access to this skill."
          retrying={editors.isFetching}
          onRetry={() => void editors.refetch()}
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
