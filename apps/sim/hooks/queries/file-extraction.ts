import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { getFileBrowserOwnerAdapter } from '@/hooks/queries/utils/file-browser-owner-adapters'

export function useExtractFile(owner: EditableFileOwner) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ fileId }: { fileId: string; fileName: string }) =>
      getFileBrowserOwnerAdapter(owner).extract(owner.entityId, fileId),
    onSuccess: (data, { fileName }) => {
      toast.success(`Unzipped "${fileName}" into "${data.folderName}"`)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Unable to unzip this archive'))
    },
    onSettled: () => getFileBrowserOwnerAdapter(owner).invalidate(client, owner.entityId),
  })
}
