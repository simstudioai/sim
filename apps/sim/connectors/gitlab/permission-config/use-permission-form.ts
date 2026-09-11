'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  GitLabPermissionData,
  GitLabPermissionUploadInput,
} from '@/lib/api/contracts/knowledge/gitlab-permissions'
import { parseGitLabCsv } from '@/connectors/gitlab/permission-config/parser'
import {
  GITLAB_CSV_MAX_BYTES,
  type GitLabCsvKind,
} from '@/connectors/gitlab/permission-config/types'

interface SelectedFile {
  upload?: { filename: string; content: string }
  rowCount?: number
  error?: string
  loading?: boolean
}

/** PATs and uploaded content stay in ephemeral component state, never in persisted setup drafts. */
export function useGitLabPermissionForm(initial?: GitLabPermissionData) {
  const generations = useRef({ userMapping: 0, projectPermissions: 0 })
  const [saved, setSaved] = useState(initial)
  const [mode, setMode] = useState<GitLabPermissionUploadInput['mode']>(
    initial?.mode ?? 'administrator'
  )
  const [files, setFiles] = useState<Partial<Record<GitLabCsvKind, SelectedFile>>>({})
  const [apiKey, setApiKey] = useState('')
  const complete =
    mode === 'administrator' ||
    (['userMapping', 'projectPermissions'] as const).every(
      (kind) =>
        !files[kind]?.error &&
        !files[kind]?.loading &&
        Boolean(files[kind]?.upload || saved?.[kind])
    )
  const dirty =
    mode !== (saved?.mode ?? 'administrator') ||
    Boolean(apiKey) ||
    (mode === 'csv' &&
      Object.values(files).some((file) => file.upload || file.error || file.loading))
  const input = useMemo<GitLabPermissionUploadInput>(
    () => ({
      provider: 'gitlab',
      mode,
      ...(saved ? { expectedRevision: saved.revision } : {}),
      ...(mode === 'csv'
        ? {
            userMapping: files.userMapping?.upload,
            projectPermissions: files.projectPermissions?.upload,
          }
        : {}),
    }),
    [files, mode, saved]
  )
  const selectFile = useCallback(async (kind: GitLabCsvKind, file: File) => {
    const generation = ++generations.current[kind]
    setFiles((previous) => ({ ...previous, [kind]: { loading: true } }))
    let selected: SelectedFile
    try {
      if (file.size > GITLAB_CSV_MAX_BYTES) throw new Error('The file must be 4 MiB or smaller.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const upload = { filename: file.name, content }
      const rows = parseGitLabCsv(upload, kind)
      selected = { upload, rowCount: rows.length }
    } catch (error) {
      selected = {
        error: getErrorMessage(error, 'Could not read this CSV. Save it as UTF-8 and try again.'),
      }
    }
    if (generation === generations.current[kind])
      setFiles((previous) => ({ ...previous, [kind]: selected }))
  }, [])
  const reset = useCallback((next?: GitLabPermissionData) => {
    generations.current.userMapping++
    generations.current.projectPermissions++
    setFiles({})
    setApiKey('')
    setSaved(next)
    setMode(next?.mode ?? 'administrator')
  }, [])
  return {
    mode,
    setMode,
    saved,
    files,
    apiKey,
    setApiKey,
    input,
    complete,
    dirty,
    selectFile,
    reset,
  }
}

export type GitLabPermissionForm = ReturnType<typeof useGitLabPermissionForm>
