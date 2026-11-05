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
import { toast } from '@/platform/lib/data/toast'

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
    status: read.data ? 'success' : read.status,
    error: read.isError ? getErrorMessage(read.error, 'Failed to load whitelabeling settings') : '',
    retry: () => void read.refetch(),
    entitled: read.data?.isEnterprise ?? false,
    settings: read.data?.settings,
    /** Logos are stored against a workspace, so upload needs one in this organization. */
    uploadWorkspaceId: workspaces.data?.find(
      (workspace) => workspace.organizationId === organizationId
    )?.id,
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
  const [logoUrl, setLogoUrl] = useState(saved.logoUrl)
  const [wordmarkUrl, setWordmarkUrl] = useState(saved.wordmarkUrl)
  const onUploadError = (message: string) => toast.error(message)
  const logo = useProfilePictureUpload({
    currentImage: logoUrl,
    onUpload: setLogoUrl,
    onError: onUploadError,
    context: 'workspace-logos',
    workspaceId: uploadWorkspaceId,
  })
  const wordmark = useProfilePictureUpload({
    currentImage: wordmarkUrl,
    onUpload: setWordmarkUrl,
    onError: onUploadError,
    context: 'workspace-logos',
    workspaceId: uploadWorkspaceId,
  })
  const dirty =
    TEXT_FIELDS.some((field) => text[field] !== saved.text[field]) ||
    (logo.previewUrl || null) !== saved.logoUrl ||
    (wordmark.previewUrl || null) !== saved.wordmarkUrl
  const uploading = logo.isUploading || wordmark.isUploading
  const saving = update.isPending || uploading
  function discard() {
    if (saving) return
    logo.reset()
    wordmark.reset()
    setText(saved.text)
    setLogoUrl(saved.logoUrl)
    setWordmarkUrl(saved.wordmarkUrl)
  }
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
    logo: {
      url: logo.previewUrl,
      uploading: logo.isUploading,
      upload: (file: File) => void logo.handleFile(file),
      remove: logo.handleRemove,
    },
    wordmark: {
      url: wordmark.previewUrl,
      uploading: wordmark.isUploading,
      upload: (file: File) => void wordmark.handleFile(file),
      remove: wordmark.handleRemove,
    },
    discard,
    save: async () => {
      if (saving) return
      const form = { ...text, logoUrl: logo.previewUrl, wordmarkUrl: wordmark.previewUrl }
      const invalid = findInvalidWhitelabelColor(form)
      if (invalid) {
        toast.error(invalid)
        return
      }
      try {
        await update.mutateAsync({
          orgId: organizationId,
          settings: toWhitelabelPayload(form),
        })
        setSaved({ text, logoUrl: logo.previewUrl, wordmarkUrl: wordmark.previewUrl })
        toast.success('Whitelabeling settings saved.')
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not save whitelabeling settings'))
      }
    },
  }
}
