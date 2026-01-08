import { GoogleSlidesIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleSlidesResponse } from '@/tools/google_slides/types'

export const GoogleSlidesBlock: BlockConfig<GoogleSlidesResponse> = {
  type: 'google_slides',
  name: 'Google Slides',
  description: 'Read, write, and create presentations',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Slides into the workflow. Can read, write, create presentations, replace text, add slides, add images, and get thumbnails.',
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
        value: ['read', 'write', 'replace_all_text', 'add_slide', 'add_image', 'get_thumbnail'],
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
        value: ['read', 'write', 'replace_all_text', 'add_slide', 'add_image', 'get_thumbnail'],
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
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'Public URL of the image (PNG, JPEG, or GIF)',
      condition: { field: 'operation', value: 'add_image' },
      required: true,
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
          default:
            throw new Error(`Invalid Google Slides operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          presentationId,
          manualPresentationId,
          folderSelector,
          folderId,
          slideIndex,
          createContent,
          thumbnailPageId,
          imageWidth,
          imageHeight,
          ...rest
        } = params

        const effectivePresentationId = (presentationId || manualPresentationId || '').trim()
        const effectiveFolderId = (folderSelector || folderId || '').trim()

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

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Slides access token' },
    presentationId: { type: 'string', description: 'Presentation identifier' },
    manualPresentationId: { type: 'string', description: 'Manual presentation identifier' },
    // Write operation
    slideIndex: { type: 'number', description: 'Slide index to write to' },
    content: { type: 'string', description: 'Slide content' },
    // Create operation
    title: { type: 'string', description: 'Presentation title' },
    folderSelector: { type: 'string', description: 'Selected folder' },
    folderId: { type: 'string', description: 'Folder identifier' },
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
    imageUrl: { type: 'string', description: 'Image URL' },
    imageWidth: { type: 'number', description: 'Image width in points' },
    imageHeight: { type: 'number', description: 'Image height in points' },
    positionX: { type: 'number', description: 'X position in points' },
    positionY: { type: 'number', description: 'Y position in points' },
    // Get thumbnail operation
    thumbnailPageId: { type: 'string', description: 'Slide object ID for thumbnail' },
    thumbnailSize: { type: 'string', description: 'Thumbnail size' },
    mimeType: { type: 'string', description: 'Image format (PNG or GIF)' },
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
  },
}
