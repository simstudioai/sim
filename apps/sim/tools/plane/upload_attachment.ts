import type {
  PlaneUploadAttachmentParams,
  PlaneUploadAttachmentResponse,
} from '@/tools/plane/types'
import {
  PLANE_ATTACHMENT_PROPERTIES,
  PLANE_CONNECTION_PARAMS,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
} from '@/tools/plane/utils'
import type { InternalToolConfig } from '@/tools/types'

export const planeUploadAttachmentTool: InternalToolConfig<
  PlaneUploadAttachmentParams,
  PlaneUploadAttachmentResponse
> = {
  id: 'plane_upload_attachment',
  name: 'Plane Upload Attachment',
  description: 'Upload a file and attach it to a Plane work item',
  version: '1.0.0',

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'File to attach to the work item',
    },
  },

  operation: {
    input: (params) => ({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      workspaceSlug: params.workspaceSlug,
      projectId: params.projectId,
      workItemId: params.workItemId,
      file: params.file,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'Failed to upload Plane attachment')
    }
    return { success: true, output: data.output }
  },

  outputs: {
    attachment: {
      type: 'object',
      description: 'The uploaded attachment',
      properties: PLANE_ATTACHMENT_PROPERTIES,
    },
  },
}
