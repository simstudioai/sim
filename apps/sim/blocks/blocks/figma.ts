import { FigmaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { FigmaResponse } from '@/tools/figma/types'

export const FigmaBlock: BlockConfig<FigmaResponse> = {
  type: 'figma',
  name: 'Figma',
  description: 'Access Figma designs and assets',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrates Figma into the workflow. Get design files, export images, list and add comments, and access components and styles from your Figma workspace.',
  docsLink: 'https://docs.sim.ai/tools/figma',
  category: 'tools',
  bgColor: '#1E1E1E',
  icon: FigmaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get File', id: 'get_file' },
        { label: 'Get Nodes', id: 'get_nodes' },
        { label: 'Export Images', id: 'export_images' },
        { label: 'List Comments', id: 'list_comments' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'Get Components', id: 'get_components' },
        { label: 'Get Styles', id: 'get_styles' },
      ],
      value: () => 'get_file',
    },
    {
      id: 'credential',
      title: 'Figma Account',
      type: 'oauth-input',
      serviceId: 'figma',
      requiredScopes: [
        'current_user:read',
        'file_content:read',
        'file_metadata:read',
        'file_comments:read',
        'file_comments:write',
        'library_content:read',
      ],
      placeholder: 'Select Figma account',
      required: true,
    },
    {
      id: 'fileKey',
      title: 'File Key',
      type: 'short-input',
      placeholder: 'File key from URL (figma.com/file/{key}/...)',
      required: true,
    },
    {
      id: 'nodeIds',
      title: 'Node IDs',
      type: 'short-input',
      placeholder: 'Comma-separated node IDs',
      condition: { field: 'operation', value: ['get_nodes', 'export_images'] },
      required: true,
    },
    {
      id: 'depth',
      title: 'Depth',
      type: 'short-input',
      placeholder: 'Document tree depth (optional)',
      condition: { field: 'operation', value: ['get_file', 'get_nodes'] },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'PNG', id: 'png' },
        { label: 'SVG', id: 'svg' },
        { label: 'PDF', id: 'pdf' },
        { label: 'JPG', id: 'jpg' },
      ],
      value: () => 'png',
      condition: { field: 'operation', value: 'export_images' },
    },
    {
      id: 'scale',
      title: 'Scale',
      type: 'short-input',
      placeholder: 'Scale factor 0.01-4 (default: 1)',
      condition: { field: 'operation', value: 'export_images' },
    },
    {
      id: 'message',
      title: 'Comment Message',
      type: 'long-input',
      placeholder: 'Enter your comment message',
      condition: { field: 'operation', value: 'add_comment' },
      required: true,
    },
    {
      id: 'nodeId',
      title: 'Node ID (Optional)',
      type: 'short-input',
      placeholder: 'Attach comment to specific node',
      condition: { field: 'operation', value: 'add_comment' },
    },
  ],
  tools: {
    access: [
      'figma_get_file',
      'figma_get_nodes',
      'figma_export_images',
      'figma_list_comments',
      'figma_add_comment',
      'figma_get_components',
      'figma_get_styles',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_file':
            return 'figma_get_file'
          case 'get_nodes':
            return 'figma_get_nodes'
          case 'export_images':
            return 'figma_export_images'
          case 'list_comments':
            return 'figma_list_comments'
          case 'add_comment':
            return 'figma_add_comment'
          case 'get_components':
            return 'figma_get_components'
          case 'get_styles':
            return 'figma_get_styles'
          default:
            throw new Error(`Invalid Figma operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, operation, depth, scale, ...rest } = params

        const baseParams: Record<string, unknown> = {
          credential,
          fileKey: rest.fileKey,
        }

        if (depth && (operation === 'get_file' || operation === 'get_nodes')) {
          baseParams.depth = Number(depth)
        }

        switch (operation) {
          case 'get_nodes':
            return {
              ...baseParams,
              nodeIds: rest.nodeIds,
            }
          case 'export_images':
            return {
              ...baseParams,
              nodeIds: rest.nodeIds,
              format: rest.format || 'png',
              scale: scale ? Number(scale) : undefined,
            }
          case 'add_comment':
            return {
              ...baseParams,
              message: rest.message,
              nodeId: rest.nodeId || undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Figma OAuth credential' },
    fileKey: { type: 'string', description: 'Figma file key from URL' },
    nodeIds: { type: 'string', description: 'Comma-separated node IDs' },
    depth: { type: 'number', description: 'Document tree depth' },
    format: { type: 'string', description: 'Image export format' },
    scale: { type: 'number', description: 'Image export scale' },
    message: { type: 'string', description: 'Comment message' },
    nodeId: { type: 'string', description: 'Node ID to attach comment to' },
  },
  outputs: {
    name: { type: 'string', description: 'File name' },
    lastModified: { type: 'string', description: 'Last modified timestamp' },
    thumbnailUrl: { type: 'string', description: 'File thumbnail URL' },
    version: { type: 'string', description: 'File version' },
    document: { type: 'json', description: 'Document tree structure' },
    components: { type: 'json', description: 'Components in the file' },
    styles: { type: 'json', description: 'Styles in the file' },
    nodes: { type: 'json', description: 'Requested nodes' },
    files: { type: 'json', description: 'Exported image files' },
    comments: { type: 'json', description: 'Comments on the file' },
    comment: { type: 'json', description: 'Created comment' },
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
