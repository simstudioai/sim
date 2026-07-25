'use client'

import { useState } from 'react'
import { Chip, ChipLink, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  type SkillFieldErrors,
  SkillFields,
} from '@/app/workspace/[workspaceId]/skills/components/skill-fields'
import { SkillImportButton } from '@/app/workspace/[workspaceId]/skills/components/skill-import'
import {
  isSkillNameConflictError,
  type ParsedSkill,
  parseSkillMarkdown,
  validateSkillName,
} from '@/app/workspace/[workspaceId]/skills/components/utils'
import { useCreateSkill } from '@/hooks/queries/skills'

const logger = createLogger('SkillCreate')

interface SkillCreateProps {
  workspaceId: string
}

/**
 * Full-page skill creation, mirroring the skill detail surface: a fixed action
 * bar (Import / Create skill), a heading, and the editable Name / Description /
 * Content sections. Importing a SKILL.md prefills all three fields in place.
 */
export function SkillCreate({ workspaceId }: SkillCreateProps) {
  const router = useRouter()
  const skillsHref = `/workspace/${workspaceId}/skills`

  const createSkill = useCreateSkill()

  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  /** Bumped to remount the seed-once rich Content editor on programmatic sets. */
  const [contentSeed, setContentSeed] = useState(0)
  const [errors, setErrors] = useState<SkillFieldErrors>({})

  // Drops on success so the guard pops its history sentinel before we navigate —
  // otherwise Back from the new skill lands on a stale, empty create form.
  const isDirty =
    !createSkill.isSuccess &&
    (!!nameDraft.trim() || !!descriptionDraft.trim() || !!contentDraft.trim())

  const guard = useUnsavedChangesGuard({ isDirty, backHref: skillsHref })

  const handleCreate = async () => {
    if (createSkill.isPending) return

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
      const created = await createSkill.mutateAsync({
        workspaceId,
        skill: { name: nameDraft, description: descriptionDraft, content: contentDraft },
      })
      setErrors({})
      // The upsert responds with the caller's whole skill list (built-ins
      // included), not just the new row — match by name, which is unique per
      // workspace, rather than trusting the first element.
      const createdId = created.find((skill) => skill.name === nameDraft)?.id
      router.push(createdId ? `${skillsHref}/${createdId}` : skillsHref)
    } catch (error) {
      if (isSkillNameConflictError(error)) {
        setErrors({ name: getErrorMessage(error, 'This skill name is already taken.') })
      } else {
        toast.error("Couldn't create skill", {
          description: getErrorMessage(error, 'Please try again in a moment.'),
        })
      }
      logger.error('Failed to create skill', error)
    }
  }

  const applyImportedSkill = (data: ParsedSkill) => {
    setNameDraft(data.name)
    setDescriptionDraft(data.description)
    setContentDraft(data.content)
    setErrors({})
    setContentSeed((seed) => seed + 1)
  }

  /**
   * Pasting a full SKILL.md destructures it into the fields. Gated on a real
   * YAML `name:` key so a stray `---` or heading-only snippet pastes as
   * ordinary content instead of silently overwriting all three fields.
   */
  const handleContentPaste = (text: string): boolean => {
    const parsed = parseSkillMarkdown(text)
    if (!parsed.nameFromFrontmatter) return false
    applyImportedSkill(parsed)
    return true
  }

  const back = (
    <ChipLink href={skillsHref} onClick={guard.handleBackClick} leftIcon={ArrowLeft}>
      Skills
    </ChipLink>
  )

  const actions = (
    <>
      <SkillImportButton onImport={applyImportedSkill} disabled={createSkill.isPending} />
      <Chip variant='primary' onClick={handleCreate} disabled={createSkill.isPending}>
        {createSkill.isPending ? 'Creating...' : 'Create'}
      </Chip>
    </>
  )

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={<SkillTile />}
          title='New skill'
          subtitle='Write a skill, or import an existing SKILL.md'
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
          contentKey={contentSeed}
          workspaceId={workspaceId}
          disabled={createSkill.isPending}
          onPasteText={handleContentPaste}
        />
      </CredentialDetailLayout>

      <UnsavedChangesModal
        open={guard.showUnsavedAlert}
        onOpenChange={guard.setShowUnsavedAlert}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
