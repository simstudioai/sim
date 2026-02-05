import { GoogleSlidesIcon } from '@/components/icons'
import { resolveHttpsUrlFromFileInput } from '@/lib/uploads/utils/file-utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { GoogleSlidesResponse } from '@/tools/google_slides/types'

export const GoogleSlidesBlock: BlockConfig<GoogleSlidesResponse> = {
  type: 'google_slides',
  name: 'Google Slides (Legacy)',
  description: 'Read, write, and create presentations',
  hideFromToolbar: true,
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Slides into the workflow. Can read, write, create presentations, replace text, add slides, add images, get thumbnails, get page details, delete objects, duplicate objects, reorder slides, create tables, create shapes, and insert text.',
  docsLink: 'https://docs.sim.ai/tools/google_slides',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleSlidesIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Presentation', id: 'read' },
        { label: 'Write to Presentation', id: 'write' },
        { label: 'Create Presentation', id: 'create' },
        { label: 'Replace All Text', id: 'replace_all_text' },
        { label: 'Add Slide', id: 'add_slide' },
        { label: 'Add Image', id: 'add_image' },
        { label: 'Get Thumbnail', id: 'get_thumbnail' },
        { label: 'Get Page', id: 'get_page' },
        { label: 'Delete Object', id: 'delete_object' },
        { label: 'Duplicate Object', id: 'duplicate_object' },
        { label: 'Reorder Slides', id: 'reorder_slides' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Create Shape', id: 'create_shape' },
        { label: 'Insert Text', id: 'insert_text' },
      ],
      value: () => 'read',
    },
    // Google Slides Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google account',
    },
    // Presentation selector (basic mode) - for operations that need an existing presentation
    {
      id: 'presentationId',
      title: 'Select Presentation',
      type: 'file-selector',
      canonicalParamId: 'presentationId',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.presentation',
      placeholder: 'Select a presentation',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'replace_all_text',
          'add_slide',
          'add_image',
          'get_thumbnail',
          'get_page',
          'delete_object',
          'duplicate_object',
          'reorder_slides',
          'create_table',
          'create_shape',
          'insert_text',
        ],
      },
    },
    // Manual presentation ID input (advanced mode)
    {
      id: 'manualPresentationId',
      title: 'Presentation ID',
      type: 'short-input',
      canonicalParamId: 'presentationId',
      placeholder: 'Enter presentation ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'replace_all_text',
          'add_slide',
          'add_image',
          'get_thumbnail',
          'get_page',
          'delete_object',
          'duplicate_object',
          'reorder_slides',
          'create_table',
          'create_shape',
          'insert_text',
        ],
      },
    },

    // ========== Write Operation Fields ==========
    {
      id: 'slideIndex',
      title: 'Slide Index',
      type: 'short-input',
      placeholder: 'Enter slide index (0 for first slide)',
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter slide content',
      condition: { field: 'operation', value: 'write' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate slide content based on the user's description.
Create clear, concise content suitable for a presentation slide.
- Use bullet points for lists
- Keep text brief and impactful
- Focus on key points

Return ONLY the slide content - no explanations, no markdown formatting markers, no extra text.`,
        placeholder: 'Describe what you want on this slide...',
      },
    },

    // ========== Create Operation Fields ==========
    {
      id: 'title',
      title: 'Presentation Title',
      type: 'short-input',
      placeholder: 'Enter title for the new presentation',
      condition: { field: 'operation', value: 'create' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional presentation title based on the user's description.
The title should be:
- Clear and descriptive
- Professional and engaging
- Concise (typically 3-8 words)

Examples:
- "quarterly sales" -> Q4 2024 Sales Performance Review
- "product launch" -> Introducing Our New Product Line
- "team meeting" -> Weekly Team Sync - Updates & Goals

Return ONLY the title - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe your presentation topic...',
      },
    },
    // Folder selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create' },
    },
    // Manual folder ID input (advanced mode)
    {
      id: 'folderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create' },
    },
    // Content Field for create operation
    {
      id: 'createContent',
      title: 'Initial Content',
      type: 'long-input',
      placeholder: 'Enter initial slide content (optional)',
      condition: { field: 'operation', value: 'create' },
      wandConfig: {
        enabled: true,
        prompt: `Generate initial slide content for a new presentation based on the user's description.
Create clear, concise content suitable for a title or introductory slide.
- Keep text brief and impactful
- Focus on the main message or theme

Return ONLY the slide content - no explanations, no markdown formatting markers, no extra text.`,
        placeholder: 'Describe the initial slide content...',
      },
    },

    // ========== Replace All Text Operation Fields ==========
    {
      id: 'findText',
      title: 'Find Text',
      type: 'short-input',
      placeholder: 'Text to find (e.g., {{placeholder}})',
      condition: { field: 'operation', value: 'replace_all_text' },
      required: true,
    },
    {
      id: 'replaceText',
      title: 'Replace With',
      type: 'short-input',
      placeholder: 'Text to replace with',
      condition: { field: 'operation', value: 'replace_all_text' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate replacement text based on the user's description.
The text should be appropriate for a presentation slide - concise and professional.

Return ONLY the replacement text - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the replacement text...',
      },
    },
    {
      id: 'matchCase',
      title: 'Match Case',
      type: 'switch',
      condition: { field: 'operation', value: 'replace_all_text' },
    },
    {
      id: 'pageObjectIds',
      title: 'Limit to Slides (IDs)',
      type: 'short-input',
      placeholder: 'Comma-separated slide IDs (leave empty for all)',
      condition: { field: 'operation', value: 'replace_all_text' },
      mode: 'advanced',
    },

    // ========== Add Slide Operation Fields ==========
    {
      id: 'layout',
      title: 'Slide Layout',
      type: 'dropdown',
      options: [
        { label: 'Blank', id: 'BLANK' },
        { label: 'Title', id: 'TITLE' },
        { label: 'Title and Body', id: 'TITLE_AND_BODY' },
        { label: 'Title Only', id: 'TITLE_ONLY' },
        { label: 'Title and Two Columns', id: 'TITLE_AND_TWO_COLUMNS' },
        { label: 'Section Header', id: 'SECTION_HEADER' },
        { label: 'Caption Only', id: 'CAPTION_ONLY' },
        { label: 'Main Point', id: 'MAIN_POINT' },
        { label: 'Big Number', id: 'BIG_NUMBER' },
      ],
      condition: { field: 'operation', value: 'add_slide' },
      value: () => 'BLANK',
    },
    {
      id: 'insertionIndex',
      title: 'Insertion Position',
      type: 'short-input',
      placeholder: 'Position to insert slide (leave empty for end)',
      condition: { field: 'operation', value: 'add_slide' },
    },
    {
      id: 'placeholderIdMappings',
      title: 'Placeholder ID Mappings',
      type: 'long-input',
      placeholder: 'JSON array: [{"layoutPlaceholder":{"type":"TITLE"},"objectId":"my_title"}]',
      condition: { field: 'operation', value: 'add_slide' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate Google Slides placeholder ID mappings as a JSON array.

Structure:
[
  {
    "layoutPlaceholder": {"type": "PLACEHOLDER_TYPE", "index": 0},
    "objectId": "unique_object_id"
  }
]

Placeholder types: TITLE, SUBTITLE, BODY, CENTERED_TITLE, HEADER, FOOTER, SLIDE_NUMBER, DATE_AND_TIME, CHART, TABLE, MEDIA, IMAGE

Examples:
- "title and body placeholders" -> [{"layoutPlaceholder":{"type":"TITLE"},"objectId":"title_1"},{"layoutPlaceholder":{"type":"BODY"},"objectId":"body_1"}]
- "just a title" -> [{"layoutPlaceholder":{"type":"TITLE"},"objectId":"my_title"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the placeholder mappings you need...',
        generationType: 'json-object',
      },
    },

    // ========== Add Image Operation Fields ==========
    {
      id: 'pageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide to add image to',
      condition: { field: 'operation', value: 'add_image' },
      required: true,
    },
    {
      id: 'imageFile',
      title: 'Image',
      type: 'file-upload',
      canonicalParamId: 'imageSource',
      placeholder: 'Upload image (PNG, JPEG, or GIF)',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.png,.jpg,.jpeg,.gif',
      condition: { field: 'operation', value: 'add_image' },
    },
    {
      id: 'imageUrl',
      title: 'Image',
      type: 'short-input',
      canonicalParamId: 'imageSource',
      placeholder: 'Reference image from previous blocks or enter URL',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'add_image' },
    },
    {
      id: 'imageWidth',
      title: 'Width (points)',
      type: 'short-input',
      placeholder: 'Image width in points (default: 300)',
      condition: { field: 'operation', value: 'add_image' },
    },
    {
      id: 'imageHeight',
      title: 'Height (points)',
      type: 'short-input',
      placeholder: 'Image height in points (default: 200)',
      condition: { field: 'operation', value: 'add_image' },
    },
    {
      id: 'positionX',
      title: 'X Position (points)',
      type: 'short-input',
      placeholder: 'X position from left (default: 100)',
      condition: { field: 'operation', value: 'add_image' },
    },
    {
      id: 'positionY',
      title: 'Y Position (points)',
      type: 'short-input',
      placeholder: 'Y position from top (default: 100)',
      condition: { field: 'operation', value: 'add_image' },
    },

    // ========== Get Thumbnail Operation Fields ==========
    {
      id: 'thumbnailPageId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide to get thumbnail for',
      condition: { field: 'operation', value: 'get_thumbnail' },
      required: true,
    },
    {
      id: 'thumbnailSize',
      title: 'Thumbnail Size',
      type: 'dropdown',
      options: [
        { label: 'Small (200px)', id: 'SMALL' },
        { label: 'Medium (800px)', id: 'MEDIUM' },
        { label: 'Large (1600px)', id: 'LARGE' },
      ],
      condition: { field: 'operation', value: 'get_thumbnail' },
      value: () => 'MEDIUM',
    },
    {
      id: 'mimeType',
      title: 'Image Format',
      type: 'dropdown',
      options: [
        { label: 'PNG', id: 'PNG' },
        { label: 'GIF', id: 'GIF' },
      ],
      condition: { field: 'operation', value: 'get_thumbnail' },
      value: () => 'PNG',
    },

    // ========== Get Page Operation Fields ==========
    {
      id: 'getPageObjectId',
      title: 'Page/Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide/page to retrieve',
      condition: { field: 'operation', value: 'get_page' },
      required: true,
    },

    // ========== Delete Object Operation Fields ==========
    {
      id: 'deleteObjectId',
      title: 'Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the element or slide to delete',
      condition: { field: 'operation', value: 'delete_object' },
      required: true,
    },

    // ========== Duplicate Object Operation Fields ==========
    {
      id: 'duplicateObjectId',
      title: 'Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the element or slide to duplicate',
      condition: { field: 'operation', value: 'duplicate_object' },
      required: true,
    },
    {
      id: 'duplicateObjectIds',
      title: 'Object ID Mappings',
      type: 'long-input',
      placeholder: 'JSON object: {"sourceId1":"newId1","sourceId2":"newId2"}',
      condition: { field: 'operation', value: 'duplicate_object' },
      mode: 'advanced',
    },

    // ========== Reorder Slides Operation Fields ==========
    {
      id: 'reorderSlideIds',
      title: 'Slide IDs',
      type: 'short-input',
      placeholder: 'Comma-separated slide object IDs to move',
      condition: { field: 'operation', value: 'reorder_slides' },
      required: true,
    },
    {
      id: 'reorderInsertionIndex',
      title: 'New Position',
      type: 'short-input',
      placeholder: 'Zero-based index where slides should be moved',
      condition: { field: 'operation', value: 'reorder_slides' },
      required: true,
    },

    // ========== Create Table Operation Fields ==========
    {
      id: 'tablePageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide to add the table to',
      condition: { field: 'operation', value: 'create_table' },
      required: true,
    },
    {
      id: 'tableRows',
      title: 'Rows',
      type: 'short-input',
      placeholder: 'Number of rows (minimum 1)',
      condition: { field: 'operation', value: 'create_table' },
      required: true,
    },
    {
      id: 'tableColumns',
      title: 'Columns',
      type: 'short-input',
      placeholder: 'Number of columns (minimum 1)',
      condition: { field: 'operation', value: 'create_table' },
      required: true,
    },
    {
      id: 'tableWidth',
      title: 'Width (points)',
      type: 'short-input',
      placeholder: 'Table width in points (default: 400)',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'tableHeight',
      title: 'Height (points)',
      type: 'short-input',
      placeholder: 'Table height in points (default: 200)',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'tablePositionX',
      title: 'X Position (points)',
      type: 'short-input',
      placeholder: 'X position from left (default: 100)',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'tablePositionY',
      title: 'Y Position (points)',
      type: 'short-input',
      placeholder: 'Y position from top (default: 100)',
      condition: { field: 'operation', value: 'create_table' },
    },

    // ========== Create Shape Operation Fields ==========
    {
      id: 'shapePageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide to add the shape to',
      condition: { field: 'operation', value: 'create_shape' },
      required: true,
    },
    {
      id: 'shapeType',
      title: 'Shape Type',
      type: 'dropdown',
      options: [
        { label: 'Text Box', id: 'TEXT_BOX' },
        { label: 'Rectangle', id: 'RECTANGLE' },
        { label: 'Rounded Rectangle', id: 'ROUND_RECTANGLE' },
        { label: 'Ellipse', id: 'ELLIPSE' },
        { label: 'Triangle', id: 'TRIANGLE' },
        { label: 'Diamond', id: 'DIAMOND' },
        { label: 'Star (5 points)', id: 'STAR_5' },
        { label: 'Arrow (Right)', id: 'RIGHT_ARROW' },
        { label: 'Arrow (Left)', id: 'LEFT_ARROW' },
        { label: 'Arrow (Up)', id: 'UP_ARROW' },
        { label: 'Arrow (Down)', id: 'DOWN_ARROW' },
        { label: 'Heart', id: 'HEART' },
        { label: 'Cloud', id: 'CLOUD' },
        { label: 'Lightning Bolt', id: 'LIGHTNING_BOLT' },
      ],
      condition: { field: 'operation', value: 'create_shape' },
      value: () => 'RECTANGLE',
    },
    {
      id: 'shapeWidth',
      title: 'Width (points)',
      type: 'short-input',
      placeholder: 'Shape width in points (default: 200)',
      condition: { field: 'operation', value: 'create_shape' },
    },
    {
      id: 'shapeHeight',
      title: 'Height (points)',
      type: 'short-input',
      placeholder: 'Shape height in points (default: 100)',
      condition: { field: 'operation', value: 'create_shape' },
    },
    {
      id: 'shapePositionX',
      title: 'X Position (points)',
      type: 'short-input',
      placeholder: 'X position from left (default: 100)',
      condition: { field: 'operation', value: 'create_shape' },
    },
    {
      id: 'shapePositionY',
      title: 'Y Position (points)',
      type: 'short-input',
      placeholder: 'Y position from top (default: 100)',
      condition: { field: 'operation', value: 'create_shape' },
    },

    // ========== Insert Text Operation Fields ==========
    {
      id: 'insertTextObjectId',
      title: 'Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the shape or table cell',
      condition: { field: 'operation', value: 'insert_text' },
      required: true,
    },
    {
      id: 'insertTextContent',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Text to insert',
      condition: { field: 'operation', value: 'insert_text' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate text content for a presentation slide based on the user's description.
The text should be:
- Clear and concise
- Professional and appropriate for presentations
- Well-structured with bullet points if listing items

Return ONLY the text content - no explanations, no markdown formatting markers, no extra text.`,
        placeholder: 'Describe the text you want to insert...',
      },
    },
    {
      id: 'insertTextIndex',
      title: 'Insertion Index',
      type: 'short-input',
      placeholder: 'Zero-based index (default: 0)',
      condition: { field: 'operation', value: 'insert_text' },
    },
  ],
  tools: {
    access: [
      'google_slides_read',
      'google_slides_write',
      'google_slides_create',
      'google_slides_replace_all_text',
      'google_slides_add_slide',
      'google_slides_add_image',
      'google_slides_get_thumbnail',
      'google_slides_get_page',
      'google_slides_delete_object',
      'google_slides_duplicate_object',
      'google_slides_update_slides_position',
      'google_slides_create_table',
      'google_slides_create_shape',
      'google_slides_insert_text',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_slides_read'
          case 'write':
            return 'google_slides_write'
          case 'create':
            return 'google_slides_create'
          case 'replace_all_text':
            return 'google_slides_replace_all_text'
          case 'add_slide':
            return 'google_slides_add_slide'
          case 'add_image':
            return 'google_slides_add_image'
          case 'get_thumbnail':
            return 'google_slides_get_thumbnail'
          case 'get_page':
            return 'google_slides_get_page'
          case 'delete_object':
            return 'google_slides_delete_object'
          case 'duplicate_object':
            return 'google_slides_duplicate_object'
          case 'reorder_slides':
            return 'google_slides_update_slides_position'
          case 'create_table':
            return 'google_slides_create_table'
          case 'create_shape':
            return 'google_slides_create_shape'
          case 'insert_text':
            return 'google_slides_insert_text'
          default:
            throw new Error(`Invalid Google Slides operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          presentationId,
          folderId,
          slideIndex,
          createContent,
          thumbnailPageId,
          imageWidth,
          imageHeight,
          ...rest
        } = params

        const effectivePresentationId = presentationId ? String(presentationId).trim() : ''
        const effectiveFolderId = folderId ? String(folderId).trim() : ''

        const result: Record<string, any> = {
          ...rest,
          presentationId: effectivePresentationId || undefined,
          credential,
        }

        // Handle operation-specific params
        if (params.operation === 'write' && slideIndex) {
          result.slideIndex = Number.parseInt(slideIndex as string, 10)
        }

        if (params.operation === 'create') {
          result.folderId = effectiveFolderId || undefined
          if (createContent) {
            result.content = createContent
          }
        }

        if (params.operation === 'add_slide' && params.insertionIndex) {
          result.insertionIndex = Number.parseInt(params.insertionIndex as string, 10)
        }

        if (params.operation === 'add_image') {
          if (imageWidth) {
            result.width = Number.parseInt(imageWidth as string, 10)
          }
          if (imageHeight) {
            result.height = Number.parseInt(imageHeight as string, 10)
          }
          if (params.positionX) {
            result.positionX = Number.parseInt(params.positionX as string, 10)
          }
          if (params.positionY) {
            result.positionY = Number.parseInt(params.positionY as string, 10)
          }
        }

        if (params.operation === 'get_thumbnail') {
          result.pageObjectId = thumbnailPageId
        }

        // Get Page operation
        if (params.operation === 'get_page') {
          result.pageObjectId = params.getPageObjectId
        }

        // Delete Object operation
        if (params.operation === 'delete_object') {
          result.objectId = params.deleteObjectId
        }

        // Duplicate Object operation
        if (params.operation === 'duplicate_object') {
          result.objectId = params.duplicateObjectId
          if (params.duplicateObjectIds) {
            result.objectIds = params.duplicateObjectIds
          }
        }

        // Reorder Slides operation
        if (params.operation === 'reorder_slides') {
          result.slideObjectIds = params.reorderSlideIds
          if (params.reorderInsertionIndex) {
            result.insertionIndex = Number.parseInt(params.reorderInsertionIndex as string, 10)
          }
        }

        // Create Table operation
        if (params.operation === 'create_table') {
          result.pageObjectId = params.tablePageObjectId
          if (params.tableRows) {
            result.rows = Number.parseInt(params.tableRows as string, 10)
          }
          if (params.tableColumns) {
            result.columns = Number.parseInt(params.tableColumns as string, 10)
          }
          if (params.tableWidth) {
            result.width = Number.parseInt(params.tableWidth as string, 10)
          }
          if (params.tableHeight) {
            result.height = Number.parseInt(params.tableHeight as string, 10)
          }
          if (params.tablePositionX) {
            result.positionX = Number.parseInt(params.tablePositionX as string, 10)
          }
          if (params.tablePositionY) {
            result.positionY = Number.parseInt(params.tablePositionY as string, 10)
          }
        }

        // Create Shape operation
        if (params.operation === 'create_shape') {
          result.pageObjectId = params.shapePageObjectId
          result.shapeType = params.shapeType
          if (params.shapeWidth) {
            result.width = Number.parseInt(params.shapeWidth as string, 10)
          }
          if (params.shapeHeight) {
            result.height = Number.parseInt(params.shapeHeight as string, 10)
          }
          if (params.shapePositionX) {
            result.positionX = Number.parseInt(params.shapePositionX as string, 10)
          }
          if (params.shapePositionY) {
            result.positionY = Number.parseInt(params.shapePositionY as string, 10)
          }
        }

        // Insert Text operation
        if (params.operation === 'insert_text') {
          result.objectId = params.insertTextObjectId
          result.text = params.insertTextContent
          if (params.insertTextIndex) {
            result.insertionIndex = Number.parseInt(params.insertTextIndex as string, 10)
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Slides access token' },
    presentationId: { type: 'string', description: 'Presentation identifier (canonical param)' },
    // Write operation
    slideIndex: { type: 'number', description: 'Slide index to write to' },
    content: { type: 'string', description: 'Slide content' },
    // Create operation
    title: { type: 'string', description: 'Presentation title' },
    folderId: { type: 'string', description: 'Parent folder identifier (canonical param)' },
    createContent: { type: 'string', description: 'Initial slide content' },
    // Replace all text operation
    findText: { type: 'string', description: 'Text to find' },
    replaceText: { type: 'string', description: 'Text to replace with' },
    matchCase: { type: 'boolean', description: 'Whether to match case' },
    pageObjectIds: {
      type: 'string',
      description: 'Comma-separated slide IDs to limit replacements',
    },
    // Add slide operation
    layout: { type: 'string', description: 'Slide layout' },
    insertionIndex: { type: 'number', description: 'Position to insert slide' },
    placeholderIdMappings: { type: 'string', description: 'JSON array of placeholder ID mappings' },
    // Add image operation
    pageObjectId: { type: 'string', description: 'Slide object ID for image' },
    imageSource: { type: 'json', description: 'Image source (file or URL)' },
    imageWidth: { type: 'number', description: 'Image width in points' },
    imageHeight: { type: 'number', description: 'Image height in points' },
    positionX: { type: 'number', description: 'X position in points' },
    positionY: { type: 'number', description: 'Y position in points' },
    // Get thumbnail operation
    thumbnailPageId: { type: 'string', description: 'Slide object ID for thumbnail' },
    thumbnailSize: { type: 'string', description: 'Thumbnail size' },
    mimeType: { type: 'string', description: 'Image format (PNG or GIF)' },
    // Get page operation
    getPageObjectId: { type: 'string', description: 'Page/slide object ID to retrieve' },
    // Delete object operation
    deleteObjectId: { type: 'string', description: 'Object ID to delete' },
    // Duplicate object operation
    duplicateObjectId: { type: 'string', description: 'Object ID to duplicate' },
    duplicateObjectIds: { type: 'string', description: 'JSON object ID mappings' },
    // Reorder slides operation
    reorderSlideIds: { type: 'string', description: 'Comma-separated slide IDs to move' },
    reorderInsertionIndex: { type: 'number', description: 'New position for slides' },
    // Create table operation
    tablePageObjectId: { type: 'string', description: 'Slide ID for table' },
    tableRows: { type: 'number', description: 'Number of rows' },
    tableColumns: { type: 'number', description: 'Number of columns' },
    tableWidth: { type: 'number', description: 'Table width in points' },
    tableHeight: { type: 'number', description: 'Table height in points' },
    tablePositionX: { type: 'number', description: 'Table X position in points' },
    tablePositionY: { type: 'number', description: 'Table Y position in points' },
    // Create shape operation
    shapePageObjectId: { type: 'string', description: 'Slide ID for shape' },
    shapeType: { type: 'string', description: 'Shape type' },
    shapeWidth: { type: 'number', description: 'Shape width in points' },
    shapeHeight: { type: 'number', description: 'Shape height in points' },
    shapePositionX: { type: 'number', description: 'Shape X position in points' },
    shapePositionY: { type: 'number', description: 'Shape Y position in points' },
    // Insert text operation
    insertTextObjectId: { type: 'string', description: 'Object ID for text insertion' },
    insertTextContent: { type: 'string', description: 'Text to insert' },
    insertTextIndex: { type: 'number', description: 'Insertion index' },
  },
  outputs: {
    // Read operation
    slides: { type: 'json', description: 'Presentation slides' },
    metadata: { type: 'json', description: 'Presentation metadata' },
    // Write operation
    updatedContent: { type: 'boolean', description: 'Content update status' },
    // Replace all text operation
    occurrencesChanged: { type: 'number', description: 'Number of text occurrences replaced' },
    // Add slide operation
    slideId: { type: 'string', description: 'Object ID of newly created slide' },
    // Add image operation
    imageId: { type: 'string', description: 'Object ID of newly created image' },
    // Get thumbnail operation
    contentUrl: { type: 'string', description: 'URL to the thumbnail image' },
    width: { type: 'number', description: 'Thumbnail width in pixels' },
    height: { type: 'number', description: 'Thumbnail height in pixels' },
    // Get page operation
    objectId: { type: 'string', description: 'Page object ID' },
    pageType: { type: 'string', description: 'Page type (SLIDE, MASTER, etc.)' },
    pageElements: { type: 'json', description: 'Page elements array' },
    slideProperties: { type: 'json', description: 'Slide-specific properties' },
    // Delete object operation
    deleted: { type: 'boolean', description: 'Whether object was deleted' },
    // Duplicate object operation
    duplicatedObjectId: { type: 'string', description: 'Object ID of the duplicate' },
    // Reorder slides operation
    moved: { type: 'boolean', description: 'Whether slides were moved' },
    slideObjectIds: { type: 'json', description: 'Slide IDs that were moved' },
    // Create table operation
    tableId: { type: 'string', description: 'Object ID of newly created table' },
    rows: { type: 'number', description: 'Number of rows created' },
    columns: { type: 'number', description: 'Number of columns created' },
    // Create shape operation
    shapeId: { type: 'string', description: 'Object ID of newly created shape' },
    // Insert text operation
    inserted: { type: 'boolean', description: 'Whether text was inserted' },
    text: { type: 'string', description: 'Text that was inserted' },
  },
}

const googleSlidesV2SubBlocks = (GoogleSlidesBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'imageFile') {
    return [
      {
        ...subBlock,
        canonicalParamId: 'imageFile',
      },
    ]
  }

  if (subBlock.id !== 'imageUrl') {
    return [subBlock]
  }

  return [
    {
      id: 'imageFileReference',
      title: 'Image',
      type: 'short-input' as const,
      canonicalParamId: 'imageFile',
      placeholder: 'Reference image from previous blocks',
      mode: 'advanced' as const,
      required: true,
      condition: { field: 'operation', value: 'add_image' },
    },
  ]
})

const googleSlidesV2Inputs = GoogleSlidesBlock.inputs
  ? {
      ...Object.fromEntries(
        Object.entries(GoogleSlidesBlock.inputs).filter(([key]) => key !== 'imageSource')
      ),
      imageFile: { type: 'json', description: 'Image source (file or URL)' },
    }
  : {}

export const GoogleSlidesV2Block: BlockConfig<GoogleSlidesResponse> = {
  ...GoogleSlidesBlock,
  type: 'google_slides_v2',
  name: 'Google Slides',
  description: 'Read, write, and create presentations',
  hideFromToolbar: false,
  subBlocks: googleSlidesV2SubBlocks,
  tools: {
    access: GoogleSlidesBlock.tools!.access,
    config: {
      tool: GoogleSlidesBlock.tools!.config!.tool,
      params: (params) => {
        const baseParams = GoogleSlidesBlock.tools?.config?.params
        if (!baseParams) {
          return params
        }

        if (params.operation === 'add_image') {
          const fileObject = normalizeFileInput(params.imageFile, { single: true })
          if (!fileObject) {
            throw new Error('Image file is required.')
          }
          const imageUrl = resolveHttpsUrlFromFileInput(fileObject)
          if (!imageUrl) {
            throw new Error('Image file must include a https URL.')
          }

          return baseParams({
            ...params,
            imageUrl,
          })
        }

        return baseParams(params)
      },
    },
  },
  inputs: googleSlidesV2Inputs,
}
