'use client'

import { useRef, useState } from 'react'
import { Chip, Loader, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type ParsedSkill,
  readSkillFile,
  SKILL_IMPORT_ACCEPT,
} from '@/app/workspace/[workspaceId]/skills/components/utils'

interface SkillImportButtonProps {
  onImport: (data: ParsedSkill) => void
  disabled?: boolean
}

/**
 * Header action that imports an existing SKILL.md into the create form. Opens
 * the OS file picker directly — no field on the page — and reports failures as
 * a toast, since the action bar has no room for an inline error.
 */
export function SkillImportButton({ onImport, disabled = false }: SkillImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const handleFile = async (file: File) => {
    setImporting(true)
    try {
      onImport(await readSkillFile(file))
    } catch (error) {
      toast.error("Couldn't import skill", {
        description: getErrorMessage(error, 'Please try a .md or .zip file.'),
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Chip onClick={() => inputRef.current?.click()} disabled={disabled || importing}>
        {importing ? <Loader className='size-[14px]' animate /> : 'Import'}
      </Chip>
      <input
        ref={inputRef}
        type='file'
        accept={SKILL_IMPORT_ACCEPT}
        className='hidden'
        // Reset so re-picking the same file after a failed import still fires.
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleFile(file)
        }}
      />
    </>
  )
}
