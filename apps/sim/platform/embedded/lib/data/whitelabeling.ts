'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { HEX_COLOR_REGEX } from '@/lib/branding'
import {
  findInvalidWhitelabelColor,
  normalizeHexInput,
  toWhitelabelPayload,
} from '@/ee/whitelabeling/form'
import {
  useUpdateWhitelabelSettings,
  useWhitelabelSettings,
} from '@/ee/whitelabeling/hooks/whitelabel'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useProfilePictureUpload } from '@/hooks/use-profile-picture-upload'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import { queryView } from '@/platform/shared/query-view'
import { toast } from '@/platform/shared/toast'

const TEXT_FIELDS = [
  'brandName',
  'primaryColor',
  'primaryHoverColor',
  'accentColor',
  'accentHoverColor',
  'supportEmail',
  'documentationUrl',
  'termsUrl',
  'privacyUrl',
] as const

export type WhitelabelTextField = (typeof TEXT_FIELDS)[number]
type WhitelabelText = Record<WhitelabelTextField, string>

type WhitelabelSettings = NonNullable<ReturnType<typeof useWhitelabelSettings>['data']>['settings']

function textOf(settings: WhitelabelSettings): WhitelabelText {
  return {
    brandName: settings.brandName ?? '',
    primaryColor: settings.primaryColor ?? '',
    primaryHoverColor: settings.primaryHoverColor ?? '',
    accentColor: settings.accentColor ?? '',
    accentHoverColor: settings.accentHoverColor ?? '',
    supportEmail: settings.supportEmail ?? '',
    documentationUrl: settings.documentationUrl ?? '',
    termsUrl: settings.termsUrl ?? '',
    privacyUrl: settings.privacyUrl ?? '',
  }
}

/** The entitlement comes from the read, which is the same check saving enforces. */
export function useWhitelabelRead(organizationId: string) {
  const read = useWhitelabelSettings(organizationId)
  const workspaces = useWorkspacesQuery(true)
  return {
    ...queryView(read),
    error: read.isError ? getErrorMessage(read.error, 'Failed to load whitelabeling settings') : '',
    entitled: read.data?.isEnterprise ?? false,
    settings: read.data?.settings,
    /** Logos are stored against a workspace, so upload needs one in this organization. */
    uploadWorkspaceId: workspaces.data?.find(
      (workspace) => workspace.organizationId === organizationId
    )?.id,
  }
}

/** A logo or wordmark's draft: an unsaved upload or removal, over the image it started from. */
function useBrandImage(initial: string | null, workspaceId: string | undefined) {
  const [url, setUrl] = useState(initial)
  const upload = useProfilePictureUpload({
    currentImage: url,
    onUpload: setUrl,
    onError: (message) => toast.error(message),
    context: 'workspace-logos',
    workspaceId,
  })
  return {
    url: upload.previewUrl || null,
    uploading: upload.isUploading,
    upload: (file: File) => void upload.handleFile(file),
    remove: upload.handleRemove,
    resetTo: (saved: string | null) => {
      upload.reset(saved)
      setUrl(saved)
    },
  }
}

/** One form's draft over its saved baseline. Mount it once a read has resolved. */
export function useWhitelabelForm(
  organizationId: string,
  initial: WhitelabelSettings,
  uploadWorkspaceId: string | undefined
) {
  const update = useUpdateWhitelabelSettings()
  const [text, setText] = useState(() => textOf(initial))
  const [saved, setSaved] = useState(() => ({
    text: textOf(initial),
    logoUrl: initial.logoUrl ?? null,
    wordmarkUrl: initial.wordmarkUrl ?? null,
  }))
  const logo = useBrandImage(saved.logoUrl, uploadWorkspaceId)
  const wordmark = useBrandImage(saved.wordmarkUrl, uploadWorkspaceId)
  const dirty =
    TEXT_FIELDS.some((field) => text[field] !== saved.text[field]) ||
    logo.url !== saved.logoUrl ||
    wordmark.url !== saved.wordmarkUrl
  const uploading = logo.uploading || wordmark.uploading
  const saving = update.isPending || uploading
  function discard() {
    if (saving) return
    logo.resetTo(saved.logoUrl)
    wordmark.resetTo(saved.wordmarkUrl)
    setText(saved.text)
  }
  useSettingsUnsavedGuard({ isDirty: dirty, navigationBlocked: saving, onDiscard: discard })
  return {
    text,
    dirty,
    saving,
    uploading,
    change: (field: WhitelabelTextField, value: string) =>
      setText((current) => ({ ...current, [field]: value })),
    changeColor: (field: WhitelabelTextField, value: string) =>
      setText((current) => ({ ...current, [field]: normalizeHexInput(value) })),
    colorIsValid: (value: string) => !value || HEX_COLOR_REGEX.test(value),
    logo,
    wordmark,
    discard,
    save: async () => {
      if (saving || !dirty) return
      const form = { ...text, logoUrl: logo.url, wordmarkUrl: wordmark.url }
      const invalid = findInvalidWhitelabelColor(form)
      if (invalid) {
        toast.error(invalid)
        return
      }
      try {
        const result = await update.mutateAsync({
          orgId: organizationId,
          settings: toWhitelabelPayload(form),
        })
        const savedText = textOf(result)
        setSaved({
          text: savedText,
          logoUrl: result.logoUrl ?? null,
          wordmarkUrl: result.wordmarkUrl ?? null,
        })
        setText((current) => (current === text ? savedText : current))
        toast.success('Whitelabeling settings saved.')
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not save whitelabeling settings'))
      }
    },
  }
}
