import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateShapeTool')

interface CreateShapeParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  shapeType: string
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface CreateShapeResponse {
  success: boolean
  output: {
    shapeId: string
    shapeType: string
    metadata: {
      presentationId: string
      pageObjectId: string
      url: string
    }
  }
}

// EMU (English Metric Units) conversion: 1 pt = 12700 EMU
const PT_TO_EMU = 12700

// Common shape types available in Google Slides API
const SHAPE_TYPES = [
  'TEXT_BOX',
  'RECTANGLE',
  'ROUND_RECTANGLE',
  'ELLIPSE',
  'ARC',
  'BENT_ARROW',
  'BENT_UP_ARROW',
  'BEVEL',
  'BLOCK_ARC',
  'BRACE_PAIR',
  'BRACKET_PAIR',
  'CAN',
  'CHEVRON',
  'CHORD',
  'CLOUD',
  'CORNER',
  'CUBE',
  'CURVED_DOWN_ARROW',
  'CURVED_LEFT_ARROW',
  'CURVED_RIGHT_ARROW',
  'CURVED_UP_ARROW',
  'DECAGON',
  'DIAGONAL_STRIPE',
  'DIAMOND',
  'DODECAGON',
  'DONUT',
  'DOUBLE_WAVE',
  'DOWN_ARROW',
  'DOWN_ARROW_CALLOUT',
  'FOLDED_CORNER',
  'FRAME',
  'HALF_FRAME',
  'HEART',
  'HEPTAGON',
  'HEXAGON',
  'HOME_PLATE',
  'HORIZONTAL_SCROLL',
  'IRREGULAR_SEAL_1',
  'IRREGULAR_SEAL_2',
  'LEFT_ARROW',
  'LEFT_ARROW_CALLOUT',
  'LEFT_BRACE',
  'LEFT_BRACKET',
  'LEFT_RIGHT_ARROW',
  'LEFT_RIGHT_ARROW_CALLOUT',
  'LEFT_RIGHT_UP_ARROW',
  'LEFT_UP_ARROW',
  'LIGHTNING_BOLT',
  'MATH_DIVIDE',
  'MATH_EQUAL',
  'MATH_MINUS',
  'MATH_MULTIPLY',
  'MATH_NOT_EQUAL',
  'MATH_PLUS',
  'MOON',
  'NO_SMOKING',
  'NOTCHED_RIGHT_ARROW',
  'OCTAGON',
  'PARALLELOGRAM',
  'PENTAGON',
  'PIE',
  'PLAQUE',
  'PLUS',
  'QUAD_ARROW',
  'QUAD_ARROW_CALLOUT',
  'RIBBON',
  'RIBBON_2',
  'RIGHT_ARROW',
  'RIGHT_ARROW_CALLOUT',
  'RIGHT_BRACE',
  'RIGHT_BRACKET',
  'ROUND_1_RECTANGLE',
  'ROUND_2_DIAGONAL_RECTANGLE',
  'ROUND_2_SAME_RECTANGLE',
  'RIGHT_TRIANGLE',
  'SMILEY_FACE',
  'SNIP_1_RECTANGLE',
  'SNIP_2_DIAGONAL_RECTANGLE',
  'SNIP_2_SAME_RECTANGLE',
  'SNIP_ROUND_RECTANGLE',
  'STAR_10',
  'STAR_12',
  'STAR_16',
  'STAR_24',
  'STAR_32',
  'STAR_4',
  'STAR_5',
  'STAR_6',
  'STAR_7',
  'STAR_8',
  'STRIPED_RIGHT_ARROW',
  'SUN',
  'TRAPEZOID',
  'TRIANGLE',
  'UP_ARROW',
  'UP_ARROW_CALLOUT',
  'UP_DOWN_ARROW',
  'UTURN_ARROW',
  'VERTICAL_SCROLL',
  'WAVE',
  'WEDGE_ELLIPSE_CALLOUT',
  'WEDGE_RECTANGLE_CALLOUT',
  'WEDGE_ROUND_RECTANGLE_CALLOUT',
  'FLOW_CHART_ALTERNATE_PROCESS',
  'FLOW_CHART_COLLATE',
  'FLOW_CHART_CONNECTOR',
  'FLOW_CHART_DECISION',
  'FLOW_CHART_DELAY',
  'FLOW_CHART_DISPLAY',
  'FLOW_CHART_DOCUMENT',
  'FLOW_CHART_EXTRACT',
  'FLOW_CHART_INPUT_OUTPUT',
  'FLOW_CHART_INTERNAL_STORAGE',
  'FLOW_CHART_MAGNETIC_DISK',
  'FLOW_CHART_MAGNETIC_DRUM',
  'FLOW_CHART_MAGNETIC_TAPE',
  'FLOW_CHART_MANUAL_INPUT',
  'FLOW_CHART_MANUAL_OPERATION',
  'FLOW_CHART_MERGE',
  'FLOW_CHART_MULTIDOCUMENT',
  'FLOW_CHART_OFFLINE_STORAGE',
  'FLOW_CHART_OFFPAGE_CONNECTOR',
  'FLOW_CHART_ONLINE_STORAGE',
  'FLOW_CHART_OR',
  'FLOW_CHART_PREDEFINED_PROCESS',
  'FLOW_CHART_PREPARATION',
  'FLOW_CHART_PROCESS',
  'FLOW_CHART_PUNCHED_CARD',
  'FLOW_CHART_PUNCHED_TAPE',
  'FLOW_CHART_SORT',
  'FLOW_CHART_SUMMING_JUNCTION',
  'FLOW_CHART_TERMINATOR',
  'ARROW_EAST',
  'ARROW_NORTH_EAST',
  'ARROW_NORTH',
  'SPEECH',
  'STARBURST',
  'TEARDROP',
  'ELLIPSE_RIBBON',
  'ELLIPSE_RIBBON_2',
  'CLOUD_CALLOUT',
  'CUSTOM',
] as const

export const createShapeTool: ToolConfig<CreateShapeParams, CreateShapeResponse> = {
  id: 'google_slides_create_shape',
  name: 'Create Shape in Google Slides',
  description:
    'Create a shape (rectangle, ellipse, text box, arrow, etc.) on a slide in a Google Slides presentation',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    pageObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object ID of the slide/page to add the shape to',
    },
    shapeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The type of shape to create. Common types: TEXT_BOX, RECTANGLE, ROUND_RECTANGLE, ELLIPSE, TRIANGLE, DIAMOND, STAR_5, ARROW_EAST, HEART, CLOUD',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width of the shape in points (default: 200)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Height of the shape in points (default: 100)',
    },
    positionX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'X position from the left edge in points (default: 100)',
    },
    positionY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Y position from the top edge in points (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }
      return `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const pageObjectId = params.pageObjectId?.trim()
      if (!pageObjectId) {
        throw new Error('Page Object ID is required')
      }

      let shapeType = (params.shapeType || 'RECTANGLE').toUpperCase()
      if (!SHAPE_TYPES.includes(shapeType as (typeof SHAPE_TYPES)[number])) {
        logger.warn(`Invalid shape type "${params.shapeType}", defaulting to RECTANGLE`)
        shapeType = 'RECTANGLE'
      }

      // Generate a unique object ID for the new shape
      const shapeObjectId = `shape_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // Convert points to EMU
      const widthEmu = (params.width || 200) * PT_TO_EMU
      const heightEmu = (params.height || 100) * PT_TO_EMU
      const translateX = (params.positionX || 100) * PT_TO_EMU
      const translateY = (params.positionY || 100) * PT_TO_EMU

      return {
        requests: [
          {
            createShape: {
              objectId: shapeObjectId,
              shapeType,
              elementProperties: {
                pageObjectId,
                size: {
                  width: {
                    magnitude: widthEmu,
                    unit: 'EMU',
                  },
                  height: {
                    magnitude: heightEmu,
                    unit: 'EMU',
                  },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX,
                  translateY,
                  unit: 'EMU',
                },
              },
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to create shape')
    }

    const createShapeReply = data.replies?.[0]?.createShape
    const shapeId = createShapeReply?.objectId || ''

    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''
    const shapeType = (params?.shapeType || 'RECTANGLE').toUpperCase()

    return {
      success: true,
      output: {
        shapeId,
        shapeType,
        metadata: {
          presentationId,
          pageObjectId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    shapeId: {
      type: 'string',
      description: 'The object ID of the newly created shape',
    },
    shapeType: {
      type: 'string',
      description: 'The type of shape that was created',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata including presentation ID and page object ID',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        pageObjectId: {
          type: 'string',
          description: 'The page object ID where the shape was created',
        },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
