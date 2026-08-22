import type {
  PhotonDownloadAttachmentResult,
  PhotonImessageDownloadAttachmentParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageDownloadAttachmentTool: ToolConfig<
  PhotonImessageDownloadAttachmentParams,
  PhotonDownloadAttachmentResult
> = {
  id: 'photon_imessage_download_attachment',
  name: 'Download Attachment',
  description:
    'Download a received attachment into the workflow as a file usable by downstream blocks',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Attachment ID from an iMessage trigger or Get Message output',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/download-attachment',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageDownloadAttachmentParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      attachmentId: params.attachmentId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonDownloadAttachmentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to download attachment',
      {
        attachmentId: '',
        fileName: '',
        mimeType: '',
        sizeBytes: 0,
        file: { name: '', mimeType: '', data: '' },
      },
      (output) => ({
        attachmentId: (output.attachmentId as string) ?? '',
        fileName: (output.fileName as string) ?? 'attachment',
        mimeType: (output.mimeType as string) ?? 'application/octet-stream',
        sizeBytes: (output.sizeBytes as number) ?? 0,
        // FileToolProcessor converts this ToolFileData into a stored UserFile after the tool runs.
        file: {
          name: (output.fileName as string) ?? 'attachment',
          mimeType: (output.mimeType as string) ?? 'application/octet-stream',
          data: (output.base64 as string) ?? '',
        },
      })
    )) as PhotonDownloadAttachmentResult,

  outputs: {
    attachmentId: { type: 'string', description: 'The attachment ID' },
    fileName: { type: 'string', description: 'Original file name' },
    mimeType: { type: 'string', description: 'MIME type of the file' },
    sizeBytes: { type: 'number', description: 'File size in bytes' },
    file: { type: 'file', description: 'The downloaded file, usable by downstream blocks' },
  },
}
