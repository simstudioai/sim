'use client'

import { useState } from 'react'
import { ChipModalField } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type ParsedSkill,
  readSkillFile,
  SKILL_IMPORT_ACCEPT,
} from '@/app/workspace/[workspaceId]/skills/components/utils'

interface SkillImportProps {
  onImport: (data: ParsedSkill) => void
}

/**
 * The canvas modal's Import tab: a single file field that reads a SKILL.md (or
 * a ZIP containing one) into the create form. The full-page create surface uses
 * {@link SkillImportButton} in its action bar instead of a field.
 */
export function SkillImport({ onImport }: SkillImportProps) {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const handleFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return

    setImporting(true)
    setError('')
    try {
      onImport(await readSkillFile(file))
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to process file'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <ChipModalField
      type='file'
      title='Upload File'
      accept={SKILL_IMPORT_ACCEPT}
      onChange={(files) => void handleFiles(files)}
      loading={importing}
      label={importing ? 'Importing…' : undefined}
      description='.md file with YAML frontmatter, or .zip containing a SKILL.md'
      error={error || undefined}
    />
  )
}
