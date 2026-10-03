import type {
  DatabricksGenieAttachmentParams,
  DatabricksGenieDownloadVisualizationResponse,
} from '@/tools/databricks/types'
import {
  databricksUrl,
  GENIE_MESSAGE_PARAMS,
  GENIE_READ_RETRY,
  genieAttachmentPath,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const genieDownloadVisualizationTool: ToolConfig<
  DatabricksGenieAttachmentParams,
  DatabricksGenieDownloadVisualizationResponse
> = {
  id: 'databricks_genie_download_visualization',
  name: 'Databricks Genie Download Visualization',
  description:
    'Download a chart Genie generated as a PNG image, for example to post it to Slack. The message must be COMPLETED and asked with visualization enabled. Not supported on Private Link workspaces.',
  version: '1.0.0',

  params: {
    ...GENIE_MESSAGE_PARAMS,
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The visualization attachment ID (visualizations[].attachmentId)',
    },
  },

  request: {
    url: (params) =>
      databricksUrl(params.host, `${genieAttachmentPath(params)}/download-visualization`),
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    responseType: 'binary',
    retry: GENIE_READ_RETRY,
  },

  transformResponse: async (response: Response, params) => {
    const buffer = Buffer.from(await response.arrayBuffer())
    const attachmentId = params?.attachmentId.trim() || 'visualization'

    return {
      success: true,
      output: {
        file: {
          name: `genie-visualization-${attachmentId}.png`,
          mimeType: 'image/png',
          data: buffer,
          size: buffer.length,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Rendered chart image (PNG) stored in execution files',
    },
  },
}
