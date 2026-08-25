'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, Send, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { AddPeopleModal } from '@/components/permissions'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
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
import {
  type SkillDraftShape,
  skillDraftMatchesSource,
  skillSourceChanged,
} from './skill-draft-sync'

const logger = createLogger('SkillDetail')

interface SkillDetailProps {
  workspaceId: string
  skillId: string
  /** Reuses the editor inside Sim Chat without routing away after deletion. */
  embedded?: boolean
  onDeleted?: () => void
}

/**
 * Full-page skill detail, mirroring the integration credential detail surface:
 * a fixed action bar (Share / Delete / Discard / Save), a heading, editable Name /
 * Description / Content sections, and the Skill Editors roster. Non-editors
 * and built-in template skills render read-only.
 */
export function SkillDetail({
  workspaceId,
  skillId,
  embedded = false,
  onDeleted,
}: SkillDetailProps) {
  const router = useRouter()
  const skillsHref = `/workspace/${workspaceId}/skills`

  const { data: skills = [], isPending, isPlaceholderData } = useSkills(workspaceId)
  // `keepPreviousData` carries the old cache entry across a workspace-id change,
  // so another workspace's list can read as success with no match — treat that as
  // loading so the detail never flashes "Skill not found."
  const skillsLoading = isPending || isPlaceholderData
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
  const [previousSkillSource, setPreviousSkillSource] = useState<SkillDraftShape | null>(null)

  /** Applies a full skill shape to all three drafts and remounts the Content editor. */
  const seedDrafts = (source: { name: string; description: string; content: string }) => {
    setNameDraft(source.name)
    setDescriptionDraft(source.description)
    setContentDraft(source.content)
    setErrors({})
    setContentSeed((seed) => seed + 1)
  }

  // A clean editor follows server-side changes (including Mothership edits),
  // while a background refetch must not clobber an in-progress local draft.
  if (skill) {
    const nextSource = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
    }
    const switchedSkill = previousSkillSource?.id !== skill.id
    const sourceChanged =
      previousSkillSource !== null && skillSourceChanged(previousSkillSource, nextSource)

    if (switchedSkill || sourceChanged) {
      const shouldReseed =
        switchedSkill ||
        previousSkillSource === null ||
        skillDraftMatchesSource(
          { name: nameDraft, description: descriptionDraft, content: contentDraft },
          previousSkillSource
        )
      setPreviousSkillSource(nextSource)
      if (shouldReseed) seedDrafts(skill)
    }
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
      toast.success(`Saved "${nameDraft}"`)
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
    // Optimistic: the skill leaves the list cache before the request resolves, so
    // this surface goes clean mid-flight — release up front, rearm if it fails.
    guard.release()
    try {
      await deleteSkill.mutateAsync({ workspaceId, skillId: skill.id })
      if (embedded) onDeleted?.()
      else router.replace(skillsHref)
    } catch (error) {
      guard.rearm()
      toast.error("Couldn't delete skill", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
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
    seedDrafts(parsed)
    return true
  }

  const back = embedded ? (
    <div />
  ) : (
    <ChipLink href={skillsHref} onClick={guard.handleBackClick} leftIcon={ArrowLeft}>
      Skills
    </ChipLink>
  )

  const handleDiscard = () => {
    if (skill) seedDrafts(skill)
  }

  const actions =
    skill && canEdit ? (
      <>
        <Chip leftIcon={Send} onClick={() => setShareOpen(true)}>
          Share
        </Chip>
        <Chip onClick={() => setShowDeleteConfirm(true)} disabled={deleteSkill.isPending}>
          Delete
        </Chip>
        <SaveDiscardChips
          dirty={isDirty}
          saving={updateSkill.isPending}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      </>
    ) : null

  // A delete is optimistic and settles before `router.replace` commits, so the row
  // is gone for a few frames while this surface is still mounted — hold the loading
  // frame through both phases instead of flashing "Skill not found." on the way out.
  if ((skillsLoading || deleteSkill.isPending || deleteSkill.isSuccess) && !skill) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
      </CredentialDetailLayout>
    )
  }

  if (!skill) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Skill not found.</SettingsEmptyState>
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
