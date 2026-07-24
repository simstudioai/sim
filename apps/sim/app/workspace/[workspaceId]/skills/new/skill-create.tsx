'use client'

import { useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipLink,
  ChipTextarea,
  chipFieldSurfaceClass,
  cn,
  toast,
} from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  DetailSection,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SkillImportButton } from '@/app/workspace/[workspaceId]/skills/components/skill-import'
import {
  isSkillNameConflictError,
  type ParsedSkill,
  parseSkillMarkdown,
  validateSkillName,
} from '@/app/workspace/[workspaceId]/skills/components/utils'
import { useCreateSkill } from '@/hooks/queries/skills'

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

const logger = createLogger('SkillCreate')

interface FieldErrors {
  name?: string
  description?: string
  content?: string
}

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
  const [errors, setErrors] = useState<FieldErrors>({})

  const isDirty = !!nameDraft.trim() || !!descriptionDraft.trim() || !!contentDraft.trim()

  const guard = useUnsavedChangesGuard({ isDirty, backHref: skillsHref })

  const handleCreate = async () => {
    if (createSkill.isPending) return

    const newErrors: FieldErrors = {}
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
      const createdId = created[0]?.id
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
            disabled={createSkill.isPending}
            error={!!errors.name}
          />
          <p
            className={cn(
              'mt-[9px] text-caption',
              errors.name ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
            )}
          >
            {errors.name ?? 'Lowercase letters, numbers, and hyphens (e.g. my-skill)'}
          </p>
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
            disabled={createSkill.isPending}
          />
          {errors.description && (
            <p className='mt-[9px] text-[var(--text-error)] text-caption'>{errors.description}</p>
          )}
        </DetailSection>

        <DetailSection title='Content'>
          <RichMarkdownField
            key={contentSeed}
            value={contentDraft}
            onChange={(value) => {
              setContentDraft(value)
              if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }))
            }}
            placeholder='Skill instructions in markdown...'
            minHeight={260}
            disabled={createSkill.isPending}
            error={!!errors.content}
            workspaceId={workspaceId}
            onPasteText={handleContentPaste}
          />
          {errors.content && (
            <p className='mt-[9px] text-[var(--text-error)] text-caption'>{errors.content}</p>
          )}
        </DetailSection>
      </CredentialDetailLayout>

      <UnsavedChangesModal
        open={guard.showUnsavedAlert}
        onOpenChange={guard.setShowUnsavedAlert}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
