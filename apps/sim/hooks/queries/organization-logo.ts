import { useMutation, useQueryClient } from '@tanstack/react-query'
import { validateLogoFile } from '@/lib/uploads/client/logo-file'
import { uploadInternalFileSession } from '@/lib/uploads/client/session-upload'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

export function useUploadOrganizationLogo(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => {
      const validationError = validateLogoFile(file)
      if (validationError) throw new Error(validationError)
      return uploadInternalFileSession({ purpose: 'organization_logo', organizationId, file })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(organizationId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}
