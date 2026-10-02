import { z } from 'zod'
import type { FigmaExportNodesParams, FigmaResponse } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaNodeIds,
  figmaOptionalBoolean,
  figmaOptionalNumber,
  figmaOptionalString,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaExportNodesTool: ToolConfig<
  FigmaExportNodesParams,
  FigmaResponse<{
    images: Record<string, string | null>
    err: string | null
    status: number | null
  }>
> = {
  id: 'figma_export_nodes',
  name: 'Figma Export Nodes',
  description:
    'Render selected Figma nodes as temporary asset URLs, preserving null entries for failed renderings; URLs expire after 30 days',
  version: '1.0.0',
  oauth: { required: true, provider: 'figma' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Figma OAuth access token',
    },
    fileKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Figma file key or HTTPS Figma file URL',
    },
    nodeIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated node IDs to render',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific file version ID',
    },
    scale: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image scale from 0.01 to 4',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Export format: png, jpg, svg, or pdf',
      default: 'png',
    },
    svgOutlineText: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Render SVG text as vector outlines',
    },
    svgIncludeId: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include layer names as SVG element IDs',
    },
    svgIncludeNodeId: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Figma node IDs in SVG elements',
    },
    svgSimplifyStroke: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Simplify inside/outside strokes',
    },
    contentsOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude content overlapping the node',
    },
    useAbsoluteBounds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Render the complete bounds of the node',
    },
  },
  request: {
    url: (params) => {
      const format = z.enum(['png', 'jpg', 'svg', 'pdf']).parse(params.format || 'png')
      return figmaApiUrl(figmaFilePath(params).replace('/v1/files/', '/v1/images/'), {
        ids: figmaNodeIds(params.nodeIds),
        version: figmaOptionalString(params.version, 'version'),
        scale: figmaOptionalNumber(params.scale, 'scale', { min: 0.01, max: 4 }),
        format,
        ...(format === 'svg'
          ? {
              svg_outline_text: figmaOptionalBoolean(params.svgOutlineText, 'svgOutlineText'),
              svg_include_id: figmaOptionalBoolean(params.svgIncludeId, 'svgIncludeId'),
              svg_include_node_id: figmaOptionalBoolean(
                params.svgIncludeNodeId,
                'svgIncludeNodeId'
              ),
              svg_simplify_stroke: figmaOptionalBoolean(
                params.svgSimplifyStroke,
                'svgSimplifyStroke'
              ),
            }
          : {}),
        contents_only: figmaOptionalBoolean(params.contentsOnly, 'contentsOnly'),
        use_absolute_bounds: figmaOptionalBoolean(params.useAbsoluteBounds, 'useAbsoluteBounds'),
      })
    },
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({
        images: z.record(z.string(), z.string().nullable()),
        err: z
          .string()
          .nullish()
          .transform((value) => value ?? null),
        status: z
          .number()
          .nullish()
          .transform((value) => value ?? null),
      })
      .parse(await figmaJson(response, context))
    return { success: true, output: data }
  },
  outputs: {
    err: {
      type: 'string',
      description: 'Rendering error message; null on success',
      optional: true,
      nullable: true,
    },
    status: {
      type: 'number',
      description: 'Provider rendering status; null when omitted on success',
      optional: true,
      nullable: true,
    },
    images: {
      type: 'json',
      description:
        'Map from requested node IDs to temporary export URLs or null; URLs expire after 30 days',
    },
  },
}
