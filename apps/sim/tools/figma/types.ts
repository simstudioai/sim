import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface FigmaFileParams {
  accessToken: string
  fileKey: string
}

export interface FigmaGetFileParams extends FigmaFileParams {
  version?: string
  nodeIds?: string
  depth?: number
  geometry?: string
  pluginData?: string
  branchData?: boolean
}

export interface FigmaGetFileNodesParams extends Omit<FigmaGetFileParams, 'branchData'> {
  nodeIds: string
}

export interface FigmaExportNodesParams extends FigmaFileParams {
  nodeIds: string
  version?: string
  scale?: number
  format?: 'jpg' | 'png' | 'svg' | 'pdf'
  svgOutlineText?: boolean
  svgIncludeId?: boolean
  svgIncludeNodeId?: boolean
  svgSimplifyStroke?: boolean
  contentsOnly?: boolean
  useAbsoluteBounds?: boolean
}

export interface FigmaListCommentsParams extends FigmaFileParams {
  asMarkdown?: boolean
}

export interface FigmaCreateCommentParams extends FigmaFileParams {
  message: string
  replyToCommentId?: string
  clientMeta?: FigmaCommentPosition | string
}

export interface FigmaDeleteCommentParams extends FigmaFileParams {
  commentId: string
}

export interface FigmaListVersionsParams extends FigmaFileParams {
  pageSize?: number
  before?: string
  after?: string
}

export interface FigmaResponse<T extends Record<string, unknown>> extends ToolResponse {
  output: T
}

interface FigmaUser {
  id: string
  handle: string
  img_url: string
}

type FigmaCommentPosition =
  | { x: number; y: number }
  | { node_id: string; node_offset: { x: number; y: number } }
  | {
      x: number
      y: number
      region_height: number
      region_width: number
      comment_pin_corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    }
  | {
      node_id: string
      node_offset: { x: number; y: number }
      region_height: number
      region_width: number
      comment_pin_corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    }

export interface FigmaComment {
  id: string
  client_meta: FigmaCommentPosition | null
  file_key: string
  parent_id: string | null
  user: FigmaUser
  created_at: string
  resolved_at: string | null
  message: string
  order_id: string | null
  reactions: { user: FigmaUser; emoji: string; created_at: string }[]
}

export interface FigmaVersion {
  id: string
  created_at: string
  label: string | null
  description: string | null
  user: FigmaUser
  thumbnail_url: string | null
}

export interface FigmaPublishedComponent {
  key: string
  file_key: string
  node_id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  user: FigmaUser
  thumbnail_url: string | null
  containing_frame: {
    nodeId: string | null
    name: string | null
    backgroundColor: string | null
    pageId: string
    pageName: string
    containingComponentSet: { nodeId: string | null; name: string | null } | null
  } | null
}

export interface FigmaPublishedStyle extends Omit<FigmaPublishedComponent, 'containing_frame'> {
  style_type: string
  sort_position: string
}

export interface FigmaPagination {
  prev_page: string | null
  next_page: string | null
}

export const FIGMA_FILE_METADATA_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'File name' },
  folder_name: {
    type: 'string',
    description: 'Containing folder name',
    nullable: true,
  },
  last_touched_at: { type: 'string', description: 'Last content update timestamp' },
  creator: {
    type: 'object',
    description: 'File creator',
    properties: {
      id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
      handle: { type: 'string', description: 'User display name' },
      img_url: { type: 'string', description: 'Profile image URL' },
    },
  },
  last_touched_by: {
    type: 'object',
    description: 'Last editor',
    properties: {
      id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
      handle: { type: 'string', description: 'User display name' },
      img_url: { type: 'string', description: 'Profile image URL' },
    },
    nullable: true,
  },
  thumbnail_url: {
    type: 'string',
    description: 'Thumbnail URL',
    nullable: true,
  },
  editorType: { type: 'string', description: 'Editor type' },
  version: { type: 'string', description: 'Version ID', nullable: true },
  role: { type: 'string', description: 'Caller role', nullable: true },
  link_access: {
    type: 'string',
    description: 'Link access policy',
    nullable: true,
  },
  url: { type: 'string', description: 'File URL', nullable: true },
} satisfies Record<string, OutputProperty>

export const FIGMA_COMMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  message: { type: 'string', description: 'Comment text' },
  file_key: { type: 'string', description: 'File containing the comment' },
  parent_id: {
    type: 'string',
    description: 'Root comment ID for a reply',
    nullable: true,
  },
  user: {
    type: 'object',
    description: 'Comment author',
    properties: {
      id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
      handle: { type: 'string', description: 'User display name' },
      img_url: { type: 'string', description: 'Profile image URL' },
    },
  },
  created_at: { type: 'string', description: 'Creation timestamp in UTC ISO 8601 format' },
  resolved_at: {
    type: 'string',
    description: 'Resolution timestamp',
    nullable: true,
  },
  order_id: {
    type: 'string',
    description: 'Number displayed for a root comment',
    nullable: true,
  },
  client_meta: {
    type: 'json',
    description:
      'Canvas coordinates or frame-relative position, optionally including region dimensions',
    nullable: true,
    properties: {
      x: { type: 'number', description: 'Canvas X coordinate', optional: true },
      y: { type: 'number', description: 'Canvas Y coordinate', optional: true },
      node_id: { type: 'string', description: 'Positioned node ID', optional: true },
      node_offset: {
        type: 'object',
        description: 'Offset relative to node',
        optional: true,
        properties: {
          x: { type: 'number', description: 'Relative X coordinate' },
          y: { type: 'number', description: 'Relative Y coordinate' },
        },
      },
      region_width: { type: 'number', description: 'Comment region width', optional: true },
      region_height: { type: 'number', description: 'Comment region height', optional: true },
      comment_pin_corner: { type: 'string', description: 'Region pin corner', optional: true },
    },
  },
  reactions: {
    type: 'array',
    description: 'Comment reactions',
    items: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          description: 'Reacting user',
          properties: {
            id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
            handle: { type: 'string', description: 'User display name' },
            img_url: { type: 'string', description: 'Profile image URL' },
          },
        },
        emoji: { type: 'string', description: 'Emoji shortcode' },
        created_at: { type: 'string', description: 'Reaction timestamp' },
      },
    },
  },
} satisfies Record<string, OutputProperty>

export const FIGMA_VERSION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Version ID, preserved as a string' },
  created_at: { type: 'string', description: 'Version creation timestamp' },
  label: { type: 'string', description: 'Version label', nullable: true },
  description: {
    type: 'string',
    description: 'Version description',
    nullable: true,
  },
  user: {
    type: 'object',
    description: 'Version author',
    properties: {
      id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
      handle: { type: 'string', description: 'User display name' },
      img_url: { type: 'string', description: 'Profile image URL' },
    },
  },
  thumbnail_url: {
    type: 'string',
    description: 'Version thumbnail URL',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const FIGMA_PUBLISHED_RESOURCE_OUTPUT_PROPERTIES = {
  key: { type: 'string', description: 'Published resource key' },
  file_key: { type: 'string', description: 'Containing main file key' },
  node_id: { type: 'string', description: 'Resource node ID' },
  name: { type: 'string', description: 'Resource name' },
  description: { type: 'string', description: 'Publisher description' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  user: {
    type: 'object',
    description: 'Last publisher',
    properties: {
      id: { type: 'string', description: 'Stable Figma user ID, preserved as a string' },
      handle: { type: 'string', description: 'User display name' },
      img_url: { type: 'string', description: 'Profile image URL' },
    },
  },
  thumbnail_url: {
    type: 'string',
    description: 'Resource thumbnail URL',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>
