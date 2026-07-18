'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipInput,
  ChipLink,
  ChipTextarea,
  chipFieldSurfaceClass,
  cn,
  Send,
  Switch,
  toast,
} from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { AddPeopleModal } from '@/components/permissions'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  DetailSection,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SkillMembersCard } from '@/app/workspace/[workspaceId]/skills/[skillId]/components/skill-members-card'
import { useSkillMembersController } from '@/app/workspace/[workspaceId]/skills/components/skill-members'
import {
  isSkillNameConflictError,
  parseSkillMarkdown,
} from '@/app/workspace/[workspaceId]/skills/components/utils'
import { useDeleteSkill, useSkills, useUpdateSkill } from '@/hooks/queries/skills'

const RichMarkdownField = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'
    ).then((m) => m.RichMarkdownField),
  {
    ssr: false,
    loading: () => <div className={cn('min-h-[260px]', chipFieldSurfaceClass)} />,
  }
)

const logger = createLogger('SkillDetail')

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface FieldErrors {
  name?: string
  description?: string
  content?: string
}

interface SkillDetailProps {
  workspaceId: string
  skillId: string
}

/**
 * Full-page skill detail, mirroring the integration credential detail surface:
 * a fixed action bar (Share / Delete / Save), a heading, editable Name /
 * Description / Content sections, the workspace-sharing switch, and the member
 * roster. Non-admin members and built-in template skills render read-only.
 */
export function SkillDetail({ workspaceId, skillId }: SkillDetailProps) {
  const router = useRouter()
  const skillsHref = `/workspace/${workspaceId}/skills`

  const { data: skills = [], isPending: skillsLoading } = useSkills(workspaceId)
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const members = useSkillMembersController({ skillId, workspaceId })

  const skill = skills.find((s) => s.id === skillId) ?? null
  const isBuiltin = !!skill?.readOnly
  const isSkillAdmin = !isBuiltin && skill?.role === 'admin'

  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  /** Bumped to remount the seed-once rich Content editor on programmatic sets. */
  const [contentSeed, setContentSeed] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
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
    if (!skill || !isSkillAdmin || !isDirty || updateSkill.isPending) return

    const newErrors: FieldErrors = {}
    if (!nameDraft.trim()) {
      newErrors.name = 'Name is required'
    } else if (nameDraft.length > 64) {
      newErrors.name = 'Name must be 64 characters or less'
    } else if (!KEBAB_CASE_REGEX.test(nameDraft)) {
      newErrors.name = 'Name must be kebab-case (e.g. my-skill)'
    }
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

  const handleAccessChange = (next: boolean) => {
    if (!skill) return
    if (next === skill.workspaceShared || updateSkill.isPending) return
    updateSkill.mutate(
      { workspaceId, skillId: skill.id, updates: { workspaceShared: next } },
      {
        onError: (error) => {
          toast.error("Couldn't update access", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        },
      }
    )
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
    skill && isSkillAdmin ? (
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

  const readOnly = isBuiltin || !isSkillAdmin

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={<SkillTile />}
          title={skill.name}
          subtitle={isBuiltin ? 'Built-in skill' : skill.description}
        />

        <DetailSection title='Name'>
          <ChipInput
            id='skill-name'
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value)
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
            }}
            placeholder='my-skill-name'
            autoComplete='off'
            data-lpignore='true'
            disabled={readOnly}
            error={!!errors.name}
          />
          {errors.name && (
            <p className='mt-[9px] text-[var(--text-error)] text-caption'>{errors.name}</p>
          )}
        </DetailSection>

        <DetailSection title='Description'>
          <ChipTextarea
            id='skill-description'
            rows={3}
            value={descriptionDraft}
            onChange={(event) => {
              setDescriptionDraft(event.target.value)
              if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }))
            }}
            placeholder='What this skill does and when to use it...'
            maxLength={1024}
            autoComplete='off'
            data-lpignore='true'
            disabled={readOnly}
          />
          {errors.description && (
            <p className='mt-[9px] text-[var(--text-error)] text-caption'>{errors.description}</p>
          )}
        </DetailSection>

        <DetailSection title='Content'>
          <RichMarkdownField
            key={`${skill.id}:${contentSeed}`}
            value={contentDraft}
            onChange={(value) => {
              setContentDraft(value)
              if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }))
            }}
            placeholder='Skill instructions in markdown...'
            minHeight={260}
            disabled={readOnly}
            error={!!errors.content}
            workspaceId={workspaceId}
            onPasteText={handleContentPaste}
          />
          {errors.content && (
            <p className='mt-[9px] text-[var(--text-error)] text-caption'>{errors.content}</p>
          )}
        </DetailSection>

        {!isBuiltin && (
          <DetailSection title='Access'>
            <div className='flex items-center justify-between'>
              <span className='text-[var(--text-body)] text-small'>
                Allow all workspace members to use this skill
              </span>
              <Switch
                checked={skill.workspaceShared}
                disabled={!isSkillAdmin || updateSkill.isPending}
                onCheckedChange={handleAccessChange}
              />
            </div>
            <p className='mt-[9px] text-[var(--text-muted)] text-caption'>
              {skill.workspaceShared
                ? 'Everyone in this workspace can use this skill.'
                : 'Only the members below can use this skill.'}
            </p>
          </DetailSection>
        )}

        {!isBuiltin && (
          <SkillMembersCard
            members={members}
            isAdmin={isSkillAdmin}
            workspaceShared={skill.workspaceShared}
          />
        )}
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
        existingMemberEmails={members.existingMemberEmails}
        addMember={members.addMember}
      />

      <UnsavedChangesModal
        open={guard.showUnsavedAlert}
        onOpenChange={guard.setShowUnsavedAlert}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
