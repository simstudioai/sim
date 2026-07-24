'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, Send, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { AddPeopleModal } from '@/components/permissions'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SkillEditorsCard } from '@/app/workspace/[workspaceId]/skills/[skillId]/components/skill-editors-card'
import {
  type SkillFieldErrors,
  SkillFields,
} from '@/app/workspace/[workspaceId]/skills/components/skill-fields'
import { useSkillEditorsController } from '@/app/workspace/[workspaceId]/skills/components/skill-members'
import {
  isSkillNameConflictError,
  parseSkillMarkdown,
  validateSkillName,
} from '@/app/workspace/[workspaceId]/skills/components/utils'
import { useDeleteSkill, useSkills, useUpdateSkill } from '@/hooks/queries/skills'

const logger = createLogger('SkillDetail')

interface SkillDetailProps {
  workspaceId: string
  skillId: string
}

/**
 * Full-page skill detail, mirroring the integration credential detail surface:
 * a fixed action bar (Share / Delete / Save), a heading, editable Name /
 * Description / Content sections, and the Skill Editors roster. Non-editors
 * and built-in template skills render read-only.
 */
export function SkillDetail({ workspaceId, skillId }: SkillDetailProps) {
  const router = useRouter()
  const skillsHref = `/workspace/${workspaceId}/skills`

  const { data: skills = [], isPending: skillsLoading } = useSkills(workspaceId)
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const skill = skills.find((s) => s.id === skillId) ?? null
  const isBuiltin = !!skill?.readOnly
  const editors = useSkillEditorsController({
    skillId,
    workspaceId,
    // Built-ins have no editors; skip the roster fetch (it would 404).
    enabled: !!skill && !isBuiltin,
  })
  const canEdit = !isBuiltin && !!skill?.canEdit

  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  /** Bumped to remount the seed-once rich Content editor on programmatic sets. */
  const [contentSeed, setContentSeed] = useState(0)
  const [errors, setErrors] = useState<SkillFieldErrors>({})
  const [shareOpen, setShareOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [prevSkillId, setPrevSkillId] = useState<string | null>(null)

  // Seed drafts when the skill first resolves (or the route id changes); a
  // background refetch of the same skill must not clobber an in-progress edit.
  if (skill && skill.id !== prevSkillId) {
    setPrevSkillId(skill.id)
    setNameDraft(skill.name)
    setDescriptionDraft(skill.description)
    setContentDraft(skill.content)
    setErrors({})
    setContentSeed((seed) => seed + 1)
  }

  const isDirty =
    !!skill &&
    !isBuiltin &&
    (nameDraft !== skill.name ||
      descriptionDraft !== skill.description ||
      contentDraft !== skill.content)

  const guard = useUnsavedChangesGuard({ isDirty, backHref: skillsHref })

  const handleSave = async () => {
    if (!skill || !canEdit || !isDirty || updateSkill.isPending) return

    const newErrors: SkillFieldErrors = {}
    const nameError = validateSkillName(nameDraft)
    if (nameError) newErrors.name = nameError
    if (!descriptionDraft.trim()) newErrors.description = 'Description is required'
    if (!contentDraft.trim()) newErrors.content = 'Content is required'
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    try {
      // Partial update: only the fields that changed go over the wire.
      await updateSkill.mutateAsync({
        workspaceId,
        skillId: skill.id,
        updates: {
          ...(nameDraft !== skill.name ? { name: nameDraft } : {}),
          ...(descriptionDraft !== skill.description ? { description: descriptionDraft } : {}),
          ...(contentDraft !== skill.content ? { content: contentDraft } : {}),
        },
      })
      setErrors({})
    } catch (error) {
      if (isSkillNameConflictError(error)) {
        setErrors({ name: getErrorMessage(error, 'This skill name is already taken.') })
      } else {
        toast.error("Couldn't save skill", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
      logger.error('Failed to save skill', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!skill) return
    setShowDeleteConfirm(false)
    try {
      await deleteSkill.mutateAsync({ workspaceId, skillId: skill.id })
      router.push(skillsHref)
    } catch (error) {
      logger.error('Failed to delete skill', error)
    }
  }

  /**
   * Pasting a full SKILL.md destructures it into the fields. Gated on a real
   * YAML `name:` key so a stray `---` or heading-only snippet pastes as
   * ordinary content instead of silently overwriting all three fields.
   */
  const handleContentPaste = (text: string): boolean => {
    const parsed = parseSkillMarkdown(text)
    if (!parsed.nameFromFrontmatter) return false
    setNameDraft(parsed.name)
    setDescriptionDraft(parsed.description)
    setContentDraft(parsed.content)
    setErrors({})
    setContentSeed((seed) => seed + 1)
    return true
  }

  const back = (
    <ChipLink href={skillsHref} onClick={guard.handleBackClick} leftIcon={ArrowLeft}>
      Skills
    </ChipLink>
  )

  const actions =
    skill && canEdit ? (
      <>
        <Chip leftIcon={Send} onClick={() => setShareOpen(true)}>
          Share
        </Chip>
        <Chip onClick={() => setShowDeleteConfirm(true)} disabled={deleteSkill.isPending}>
          Delete
        </Chip>
        <Chip onClick={handleSave} disabled={!isDirty || updateSkill.isPending}>
          {updateSkill.isPending ? 'Saving...' : 'Save'}
        </Chip>
      </>
    ) : null

  if (skillsLoading && !skill) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>Loading…</p>
      </CredentialDetailLayout>
    )
  }

  if (!skill) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>Skill not found.</p>
      </CredentialDetailLayout>
    )
  }

  const readOnly = isBuiltin || !canEdit
  const lockReason = !readOnly
    ? null
    : isBuiltin
      ? 'Built-in skills are read-only'
      : 'You need to be a skill editor to edit this skill'

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={<SkillTile />}
          title={skill.name}
          subtitle={isBuiltin ? 'Built-in skill' : skill.description}
        />

        <SkillFields
          name={nameDraft}
          description={descriptionDraft}
          content={contentDraft}
          onNameChange={(value) => {
            setNameDraft(value)
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
          }}
          onDescriptionChange={(value) => {
            setDescriptionDraft(value)
            if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }))
          }}
          onContentChange={(value) => {
            setContentDraft(value)
            if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }))
          }}
          errors={errors}
          contentKey={`${skill.id}:${contentSeed}`}
          workspaceId={workspaceId}
          disabled={readOnly}
          lockReason={lockReason}
          onPasteText={handleContentPaste}
        />

        {!isBuiltin && <SkillEditorsCard editors={editors} canEdit={canEdit} />}
      </CredentialDetailLayout>

      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        srTitle='Delete Skill'
        title='Delete Skill'
        text={[
          'Are you sure you want to delete ',
          { text: skill.name, bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDelete,
          pending: deleteSkill.isPending,
          pendingLabel: 'Deleting...',
        }}
      />

      <AddPeopleModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        existingMemberEmails={editors.existingEditorEmails}
        addMember={editors.addEditor}
        hideRole
      />

      <UnsavedChangesModal
        open={guard.showUnsavedAlert}
        onOpenChange={guard.setShowUnsavedAlert}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
