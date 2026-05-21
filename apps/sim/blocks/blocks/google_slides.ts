import { GoogleSlidesIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { resolveHttpsUrlFromFileInput } from '@/lib/uploads/utils/file-utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleSlidesResponse } from '@/tools/google_slides/types'

export const GoogleSlidesBlock: BlockConfig<GoogleSlidesResponse> = {
  type: 'google_slides',
  name: 'Google Slides (Legacy)',
  description: 'Read, write, and create presentations',
  hideFromToolbar: true,
  authMode: AuthMode.OAuth,
  longDescription:
    'Build, edit, and export branded Google Slides presentations end-to-end. Copy a template, replace text and image tokens, embed Sheets charts, style text and shapes with brand fonts and colors, manage tables and layouts, group elements, run atomic batch updates, and export to PDF or PPTX.',
  docsLink: 'https://docs.sim.ai/tools/google_slides',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  tags: ['google-workspace', 'document-processing', 'content-management'],
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
        { label: 'Copy Presentation', id: 'copy_presentation' },
        { label: 'Export Presentation', id: 'export_presentation' },
        { label: 'Batch Update (Raw)', id: 'batch_update' },
        { label: 'Replace All Text', id: 'replace_all_text' },
        { label: 'Replace All Shapes With Image', id: 'replace_all_shapes_with_image' },
        { label: 'Replace Image', id: 'replace_image' },
        { label: 'Update Image Properties', id: 'update_image_properties' },
        { label: 'Add Slide', id: 'add_slide' },
        { label: 'Add Image', id: 'add_image' },
        { label: 'Get Thumbnail', id: 'get_thumbnail' },
        { label: 'Get Page', id: 'get_page' },
        { label: 'Delete Object', id: 'delete_object' },
        { label: 'Duplicate Object', id: 'duplicate_object' },
        { label: 'Reorder Slides', id: 'reorder_slides' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Create Shape', id: 'create_shape' },
        { label: 'Create Line', id: 'create_line' },
        { label: 'Insert Text', id: 'insert_text' },
        { label: 'Delete Text', id: 'delete_text' },
        { label: 'Update Text Style', id: 'update_text_style' },
        { label: 'Update Paragraph Style', id: 'update_paragraph_style' },
        { label: 'Create Paragraph Bullets', id: 'create_paragraph_bullets' },
        { label: 'Delete Paragraph Bullets', id: 'delete_paragraph_bullets' },
        { label: 'Update Shape Properties', id: 'update_shape_properties' },
        { label: 'Update Page Properties', id: 'update_page_properties' },
        { label: 'Update Slide Properties', id: 'update_slide_properties' },
        { label: 'Update Alt Text', id: 'update_page_element_alt_text' },
        { label: 'Update Element Transform', id: 'update_page_element_transform' },
        { label: 'Update Z-Order', id: 'update_page_elements_z_order' },
        { label: 'Group Objects', id: 'group_objects' },
        { label: 'Ungroup Objects', id: 'ungroup_objects' },
        { label: 'Update Line Properties', id: 'update_line_properties' },
        { label: 'Update Line Category', id: 'update_line_category' },
        { label: 'Reroute Line', id: 'reroute_line' },
        { label: 'Insert Table Rows', id: 'insert_table_rows' },
        { label: 'Insert Table Columns', id: 'insert_table_columns' },
        { label: 'Delete Table Row', id: 'delete_table_row' },
        { label: 'Delete Table Column', id: 'delete_table_column' },
        { label: 'Merge Table Cells', id: 'merge_table_cells' },
        { label: 'Unmerge Table Cells', id: 'unmerge_table_cells' },
        { label: 'Update Table Cell Properties', id: 'update_table_cell_properties' },
        { label: 'Update Table Border Properties', id: 'update_table_border_properties' },
        { label: 'Update Table Column Properties', id: 'update_table_column_properties' },
        { label: 'Update Table Row Properties', id: 'update_table_row_properties' },
        { label: 'Embed Sheets Chart', id: 'create_sheets_chart' },
        { label: 'Refresh Sheets Chart', id: 'refresh_sheets_chart' },
        {
          label: 'Replace All Shapes With Sheets Chart',
          id: 'replace_all_shapes_with_sheets_chart',
        },
        { label: 'Embed Video', id: 'create_video' },
        { label: 'Update Video Properties', id: 'update_video_properties' },
      ],
      value: () => 'read',
    },
    // Google Slides Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Presentation selector (basic mode) - for operations that need an existing presentation
    {
      id: 'presentationId',
      title: 'Select Presentation',
      type: 'file-selector',
      canonicalParamId: 'presentationId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
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
          'batch_update',
          'export_presentation',
          'replace_all_shapes_with_image',
          'replace_image',
          'update_image_properties',
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'update_shape_properties',
          'update_page_properties',
          'update_slide_properties',
          'update_page_element_alt_text',
          'update_page_element_transform',
          'update_page_elements_z_order',
          'group_objects',
          'ungroup_objects',
          'create_line',
          'update_line_properties',
          'update_line_category',
          'reroute_line',
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
          'update_table_column_properties',
          'update_table_row_properties',
          'create_sheets_chart',
          'refresh_sheets_chart',
          'replace_all_shapes_with_sheets_chart',
          'create_video',
          'update_video_properties',
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
          'batch_update',
          'export_presentation',
          'replace_all_shapes_with_image',
          'replace_image',
          'update_image_properties',
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
          'update_shape_properties',
          'update_page_properties',
          'update_slide_properties',
          'update_page_element_alt_text',
          'update_page_element_transform',
          'update_page_elements_z_order',
          'group_objects',
          'ungroup_objects',
          'create_line',
          'update_line_properties',
          'update_line_category',
          'reroute_line',
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
          'update_table_column_properties',
          'update_table_row_properties',
          'create_sheets_chart',
          'refresh_sheets_chart',
          'replace_all_shapes_with_sheets_chart',
          'create_video',
          'update_video_properties',
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
      selectorKey: 'google.drive',
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

    // ========== Copy Presentation Operation Fields ==========
    {
      id: 'sourcePresentationSelector',
      title: 'Source Presentation',
      type: 'file-selector',
      canonicalParamId: 'sourcePresentationId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.presentation',
      placeholder: 'Select template presentation to copy',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'copy_presentation' },
      required: true,
    },
    {
      id: 'manualSourcePresentationId',
      title: 'Source Presentation ID',
      type: 'short-input',
      canonicalParamId: 'sourcePresentationId',
      placeholder: 'Enter source presentation ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy_presentation' },
      required: true,
    },
    {
      id: 'copyTitle',
      title: 'Copy Title',
      type: 'short-input',
      placeholder: 'Title for the copy (defaults to "Copy of <source>")',
      condition: { field: 'operation', value: 'copy_presentation' },
    },
    {
      id: 'copyFolderSelector',
      title: 'Destination Folder',
      type: 'file-selector',
      canonicalParamId: 'copyFolderId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select destination folder (optional)',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'copy_presentation' },
    },
    {
      id: 'manualCopyFolderId',
      title: 'Destination Folder ID',
      type: 'short-input',
      canonicalParamId: 'copyFolderId',
      placeholder: 'Folder ID (optional)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy_presentation' },
    },

    // ========== Export Presentation Operation Fields ==========
    {
      id: 'exportFormat',
      title: 'Export Format',
      type: 'dropdown',
      options: [
        { label: 'PDF', id: 'PDF' },
        { label: 'PowerPoint (PPTX)', id: 'PPTX' },
        { label: 'OpenDocument (ODP)', id: 'ODP' },
        { label: 'Plain Text', id: 'TXT' },
        { label: 'PNG (first slide)', id: 'PNG' },
        { label: 'JPEG (first slide)', id: 'JPEG' },
        { label: 'SVG (first slide)', id: 'SVG' },
      ],
      value: () => 'PDF',
      condition: { field: 'operation', value: 'export_presentation' },
    },

    // ========== Batch Update (Raw) Operation Fields ==========
    {
      id: 'requestsJson',
      title: 'Requests (JSON Array)',
      type: 'long-input',
      placeholder:
        'JSON array of Slides API Request objects, e.g. [{"replaceAllText":{...}}, {"updatePageProperties":{...}}]',
      condition: { field: 'operation', value: 'batch_update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Produce a JSON array of Google Slides API Request objects matching the user's intent. Each item must be a valid Request — for example {"replaceAllText": {...}}, {"updateTextStyle": {...}}, {"createSlide": {...}}. Return ONLY the JSON array, no commentary.`,
        placeholder: 'Describe the batch update you want to run...',
        generationType: 'json-object',
      },
    },
    {
      id: 'writeControlJson',
      title: 'Write Control (JSON)',
      type: 'long-input',
      placeholder: '{"requiredRevisionId":"..."} or {"targetRevisionId":"..."}',
      condition: { field: 'operation', value: 'batch_update' },
      mode: 'advanced',
    },

    // ========== Replace All Shapes With Image Fields ==========
    {
      id: 'replaceShapesImageUrl',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'Publicly fetchable image URL (PNG, JPEG, GIF)',
      condition: { field: 'operation', value: 'replace_all_shapes_with_image' },
      required: true,
    },
    {
      id: 'replaceShapesFindText',
      title: 'Find Text (Token)',
      type: 'short-input',
      placeholder: 'Shape text token, e.g. {{cover-image}}',
      condition: { field: 'operation', value: 'replace_all_shapes_with_image' },
      required: true,
    },
    {
      id: 'replaceShapesMatchCase',
      title: 'Match Case',
      type: 'switch',
      condition: { field: 'operation', value: 'replace_all_shapes_with_image' },
    },
    {
      id: 'replaceShapesImageMethod',
      title: 'Image Fit',
      type: 'dropdown',
      options: [
        { label: 'Center Inside (preserve aspect)', id: 'CENTER_INSIDE' },
        { label: 'Center Crop (fill, crop)', id: 'CENTER_CROP' },
      ],
      value: () => 'CENTER_INSIDE',
      condition: { field: 'operation', value: 'replace_all_shapes_with_image' },
    },
    {
      id: 'replaceShapesPageObjectIds',
      title: 'Limit to Slides (IDs)',
      type: 'short-input',
      placeholder: 'Comma-separated slide IDs (empty = all)',
      condition: { field: 'operation', value: 'replace_all_shapes_with_image' },
      mode: 'advanced',
    },

    // ========== Replace Image Fields ==========
    {
      id: 'replaceImageObjectId',
      title: 'Image Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the existing image to replace',
      condition: { field: 'operation', value: 'replace_image' },
      required: true,
    },
    {
      id: 'replaceImageUrl',
      title: 'New Image URL',
      type: 'short-input',
      placeholder: 'Publicly fetchable image URL',
      condition: { field: 'operation', value: 'replace_image' },
      required: true,
    },
    {
      id: 'replaceImageMethod',
      title: 'Image Fit',
      type: 'dropdown',
      options: [
        { label: 'Center Inside (preserve aspect)', id: 'CENTER_INSIDE' },
        { label: 'Center Crop (fill, crop)', id: 'CENTER_CROP' },
      ],
      value: () => 'CENTER_INSIDE',
      condition: { field: 'operation', value: 'replace_image' },
    },

    // ========== Update Image Properties Fields ==========
    {
      id: 'imagePropsObjectId',
      title: 'Image Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the image',
      condition: { field: 'operation', value: 'update_image_properties' },
      required: true,
    },
    {
      id: 'imageBrightness',
      title: 'Brightness',
      type: 'short-input',
      placeholder: '-1.0 to 1.0',
      condition: { field: 'operation', value: 'update_image_properties' },
    },
    {
      id: 'imageContrast',
      title: 'Contrast',
      type: 'short-input',
      placeholder: '-1.0 to 1.0',
      condition: { field: 'operation', value: 'update_image_properties' },
    },
    {
      id: 'imageTransparency',
      title: 'Transparency',
      type: 'short-input',
      placeholder: '0.0 (opaque) to 1.0 (transparent)',
      condition: { field: 'operation', value: 'update_image_properties' },
    },
    {
      id: 'imageLinkUrl',
      title: 'Link URL',
      type: 'short-input',
      placeholder: 'Make the image a hyperlink',
      condition: { field: 'operation', value: 'update_image_properties' },
    },
    {
      id: 'imageOutlineColor',
      title: 'Outline Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #1A73E8',
      condition: { field: 'operation', value: 'update_image_properties' },
      mode: 'advanced',
    },
    {
      id: 'imageOutlineWeight',
      title: 'Outline Weight (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_image_properties' },
      mode: 'advanced',
    },
    {
      id: 'imageOutlineDashStyle',
      title: 'Outline Dash Style',
      type: 'short-input',
      placeholder: 'SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
      condition: { field: 'operation', value: 'update_image_properties' },
      mode: 'advanced',
    },
    {
      id: 'imagePropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      placeholder: 'Raw ImageProperties JSON (merged with the simple fields)',
      condition: { field: 'operation', value: 'update_image_properties' },
      mode: 'advanced',
    },
    {
      id: 'imagePropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated field mask',
      condition: { field: 'operation', value: 'update_image_properties' },
      mode: 'advanced',
    },

    // ========== Text Style Fields ==========
    {
      id: 'textObjectId',
      title: 'Object ID',
      type: 'short-input',
      placeholder: 'Shape or table object ID containing the text',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
      required: true,
    },
    {
      id: 'textRowIndex',
      title: 'Table Cell Row Index',
      type: 'short-input',
      placeholder: 'Zero-based row (for table cells only)',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'textColumnIndex',
      title: 'Table Cell Column Index',
      type: 'short-input',
      placeholder: 'Zero-based column (for table cells only)',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'textRangeType',
      title: 'Range Type',
      type: 'dropdown',
      options: [
        { label: 'All Text', id: 'ALL' },
        { label: 'From Start Index', id: 'FROM_START_INDEX' },
        { label: 'Fixed Range', id: 'FIXED_RANGE' },
      ],
      value: () => 'ALL',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
    },
    {
      id: 'textStartIndex',
      title: 'Start Index',
      type: 'short-input',
      placeholder: 'Required for FROM_START_INDEX or FIXED_RANGE',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'textEndIndex',
      title: 'End Index',
      type: 'short-input',
      placeholder: 'Required for FIXED_RANGE',
      condition: {
        field: 'operation',
        value: [
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ],
      },
      mode: 'advanced',
    },

    // update_text_style specific
    {
      id: 'textBold',
      title: 'Bold',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textItalic',
      title: 'Italic',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textUnderline',
      title: 'Underline',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textStrikethrough',
      title: 'Strikethrough',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textSmallCaps',
      title: 'Small Caps',
      type: 'switch',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textFontFamily',
      title: 'Font Family',
      type: 'short-input',
      placeholder: 'e.g. Inter, Roboto, Arial',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textFontSize',
      title: 'Font Size (pt)',
      type: 'short-input',
      placeholder: 'Numeric, e.g. 14',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textForegroundColor',
      title: 'Text Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #1A73E8',
      condition: { field: 'operation', value: 'update_text_style' },
    },
    {
      id: 'textBackgroundColor',
      title: 'Text Background Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #FFF8E1',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textLinkUrl',
      title: 'Link URL',
      type: 'short-input',
      placeholder: 'Hyperlink URL for the range',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textBaselineOffset',
      title: 'Baseline Offset',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'NONE' },
        { label: 'Superscript', id: 'SUPERSCRIPT' },
        { label: 'Subscript', id: 'SUBSCRIPT' },
      ],
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textStyleJson',
      title: 'Style JSON (advanced)',
      type: 'long-input',
      placeholder: 'Raw TextStyle JSON (merged with the simple fields)',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },
    {
      id: 'textStyleFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated field mask',
      condition: { field: 'operation', value: 'update_text_style' },
      mode: 'advanced',
    },

    // update_paragraph_style specific
    {
      id: 'paragraphAlignment',
      title: 'Alignment',
      type: 'dropdown',
      options: [
        { label: 'Start', id: 'START' },
        { label: 'Center', id: 'CENTER' },
        { label: 'End', id: 'END' },
        { label: 'Justified', id: 'JUSTIFIED' },
      ],
      condition: { field: 'operation', value: 'update_paragraph_style' },
    },
    {
      id: 'paragraphLineSpacing',
      title: 'Line Spacing (%)',
      type: 'short-input',
      placeholder: '100 = single, 200 = double',
      condition: { field: 'operation', value: 'update_paragraph_style' },
    },
    {
      id: 'paragraphIndentStart',
      title: 'Indent Start (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphIndentEnd',
      title: 'Indent End (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphIndentFirstLine',
      title: 'First-Line Indent (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphSpaceAbove',
      title: 'Space Above (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphSpaceBelow',
      title: 'Space Below (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphDirection',
      title: 'Direction',
      type: 'dropdown',
      options: [
        { label: 'Left to Right', id: 'LEFT_TO_RIGHT' },
        { label: 'Right to Left', id: 'RIGHT_TO_LEFT' },
      ],
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphSpacingMode',
      title: 'Spacing Mode',
      type: 'dropdown',
      options: [
        { label: 'Never Collapse', id: 'NEVER_COLLAPSE' },
        { label: 'Collapse Lists', id: 'COLLAPSE_LISTS' },
      ],
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphStyleJson',
      title: 'Style JSON (advanced)',
      type: 'long-input',
      placeholder: 'Raw ParagraphStyle JSON (merged with the simple fields)',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },
    {
      id: 'paragraphStyleFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. alignment,lineSpacing,indentStart',
      condition: { field: 'operation', value: 'update_paragraph_style' },
      mode: 'advanced',
    },

    // create_paragraph_bullets specific
    {
      id: 'bulletPreset',
      title: 'Bullet Preset',
      type: 'dropdown',
      options: [
        { label: 'Disc / Circle / Square', id: 'BULLET_DISC_CIRCLE_SQUARE' },
        { label: 'Diamond / Arrow / Disc', id: 'BULLET_DIAMONDX_ARROW3D_SQUARE' },
        { label: 'Checkbox', id: 'BULLET_CHECKBOX' },
        { label: 'Arrow / Diamond / Disc', id: 'BULLET_ARROW_DIAMOND_DISC' },
        { label: 'Star / Circle / Disc', id: 'BULLET_STAR_CIRCLE_DISC' },
        { label: 'Arrow3D / Circle / Square', id: 'BULLET_ARROW3D_CIRCLE_SQUARE' },
        { label: 'Left Triangle / Diamond / Disc', id: 'BULLET_LEFTTRIANGLE_DIAMOND_DISC' },
        { label: 'Numbered Digit/Alpha/Roman', id: 'NUMBERED_DIGIT_ALPHA_ROMAN' },
        { label: 'Numbered Digit/Alpha/Roman (parens)', id: 'NUMBERED_DIGIT_ALPHA_ROMAN_PARENS' },
        { label: 'Numbered Digit Nested', id: 'NUMBERED_DIGIT_NESTED' },
        { label: 'Numbered Upper Alpha / Alpha / Roman', id: 'NUMBERED_UPPERALPHA_ALPHA_ROMAN' },
        {
          label: 'Numbered Upper Roman / Upper Alpha / Digit',
          id: 'NUMBERED_UPPERROMAN_UPPERALPHA_DIGIT',
        },
        { label: 'Numbered Zero-Digit / Alpha / Roman', id: 'NUMBERED_ZERODIGIT_ALPHA_ROMAN' },
      ],
      value: () => 'BULLET_DISC_CIRCLE_SQUARE',
      condition: { field: 'operation', value: 'create_paragraph_bullets' },
    },

    // ========== Update Shape Properties Fields ==========
    {
      id: 'shapePropsObjectId',
      title: 'Shape Object ID',
      type: 'short-input',
      placeholder: 'Object ID of the shape',
      condition: { field: 'operation', value: 'update_shape_properties' },
      required: true,
    },
    {
      id: 'shapeFillColor',
      title: 'Fill Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #FF6F61',
      condition: { field: 'operation', value: 'update_shape_properties' },
    },
    {
      id: 'shapeFillAlpha',
      title: 'Fill Opacity',
      type: 'short-input',
      placeholder: '0.0 to 1.0',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapeFillUnset',
      title: 'Clear Fill (inherit)',
      type: 'switch',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapeOutlineColor',
      title: 'Outline Color',
      type: 'short-input',
      placeholder: 'Hex',
      condition: { field: 'operation', value: 'update_shape_properties' },
    },
    {
      id: 'shapeOutlineWeight',
      title: 'Outline Weight (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_shape_properties' },
    },
    {
      id: 'shapeOutlineDashStyle',
      title: 'Outline Dash Style',
      type: 'short-input',
      placeholder: 'SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapeOutlineUnset',
      title: 'Clear Outline (inherit)',
      type: 'switch',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapeLinkUrl',
      title: 'Link URL',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapeContentAlignment',
      title: 'Content Alignment',
      type: 'dropdown',
      options: [
        { label: 'Top', id: 'TOP' },
        { label: 'Middle', id: 'MIDDLE' },
        { label: 'Bottom', id: 'BOTTOM' },
      ],
      condition: { field: 'operation', value: 'update_shape_properties' },
    },
    {
      id: 'shapeAutofitType',
      title: 'Autofit',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'NONE' },
        { label: 'Text Autofit', id: 'TEXT_AUTOFIT' },
        { label: 'Shape Autofit', id: 'SHAPE_AUTOFIT' },
      ],
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapePropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },
    {
      id: 'shapePropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. shapeBackgroundFill,outline,contentAlignment',
      condition: { field: 'operation', value: 'update_shape_properties' },
      mode: 'advanced',
    },

    // ========== Update Page Properties Fields ==========
    {
      id: 'pagePropsObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide',
      condition: { field: 'operation', value: 'update_page_properties' },
      required: true,
    },
    {
      id: 'pageBackgroundColor',
      title: 'Background Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #0B1F3A',
      condition: { field: 'operation', value: 'update_page_properties' },
    },
    {
      id: 'pageBackgroundAlpha',
      title: 'Background Opacity',
      type: 'short-input',
      placeholder: '0.0 to 1.0',
      condition: { field: 'operation', value: 'update_page_properties' },
      mode: 'advanced',
    },
    {
      id: 'pageBackgroundImageUrl',
      title: 'Background Image URL',
      type: 'short-input',
      placeholder: 'Publicly fetchable image URL',
      condition: { field: 'operation', value: 'update_page_properties' },
    },
    {
      id: 'pageBackgroundUnset',
      title: 'Clear Background (inherit)',
      type: 'switch',
      condition: { field: 'operation', value: 'update_page_properties' },
      mode: 'advanced',
    },
    {
      id: 'pagePropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_page_properties' },
      mode: 'advanced',
    },
    {
      id: 'pagePropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. pageBackgroundFill',
      condition: { field: 'operation', value: 'update_page_properties' },
      mode: 'advanced',
    },

    // ========== Update Slide Properties Fields ==========
    {
      id: 'slidePropsObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide',
      condition: { field: 'operation', value: 'update_slide_properties' },
      required: true,
    },
    {
      id: 'slideIsSkipped',
      title: 'Skip Slide in Presentation',
      type: 'switch',
      condition: { field: 'operation', value: 'update_slide_properties' },
    },
    {
      id: 'slidePropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_slide_properties' },
      mode: 'advanced',
    },
    {
      id: 'slidePropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. isSkipped',
      condition: { field: 'operation', value: 'update_slide_properties' },
      mode: 'advanced',
    },

    // ========== Update Alt Text Fields ==========
    {
      id: 'altTextObjectId',
      title: 'Element Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_alt_text' },
      required: true,
    },
    {
      id: 'altTextTitle',
      title: 'Accessibility Title',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_alt_text' },
    },
    {
      id: 'altTextDescription',
      title: 'Accessibility Description',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_page_element_alt_text' },
    },

    // ========== Update Element Transform Fields ==========
    {
      id: 'transformObjectId',
      title: 'Element Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_transform' },
      required: true,
    },
    {
      id: 'transformScaleX',
      title: 'Scale X',
      type: 'short-input',
      placeholder: 'Default 1',
      condition: { field: 'operation', value: 'update_page_element_transform' },
    },
    {
      id: 'transformScaleY',
      title: 'Scale Y',
      type: 'short-input',
      placeholder: 'Default 1',
      condition: { field: 'operation', value: 'update_page_element_transform' },
    },
    {
      id: 'transformShearX',
      title: 'Shear X',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_transform' },
      mode: 'advanced',
    },
    {
      id: 'transformShearY',
      title: 'Shear Y',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_transform' },
      mode: 'advanced',
    },
    {
      id: 'transformTranslateX',
      title: 'X Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_transform' },
    },
    {
      id: 'transformTranslateY',
      title: 'Y Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_page_element_transform' },
    },
    {
      id: 'transformApplyMode',
      title: 'Apply Mode',
      type: 'dropdown',
      options: [
        { label: 'Absolute (replace)', id: 'ABSOLUTE' },
        { label: 'Relative (multiply)', id: 'RELATIVE' },
      ],
      value: () => 'ABSOLUTE',
      condition: { field: 'operation', value: 'update_page_element_transform' },
    },

    // ========== Z-Order Fields ==========
    {
      id: 'zOrderObjectIds',
      title: 'Object IDs',
      type: 'short-input',
      placeholder: 'Comma-separated element IDs',
      condition: { field: 'operation', value: 'update_page_elements_z_order' },
      required: true,
    },
    {
      id: 'zOrderOperation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Bring to Front', id: 'BRING_TO_FRONT' },
        { label: 'Bring Forward', id: 'BRING_FORWARD' },
        { label: 'Send Backward', id: 'SEND_BACKWARD' },
        { label: 'Send to Back', id: 'SEND_TO_BACK' },
      ],
      condition: { field: 'operation', value: 'update_page_elements_z_order' },
      required: true,
    },

    // ========== Group / Ungroup Fields ==========
    {
      id: 'groupChildrenObjectIds',
      title: 'Children Object IDs',
      type: 'short-input',
      placeholder: 'Comma-separated element IDs (same slide)',
      condition: { field: 'operation', value: 'group_objects' },
      required: true,
    },
    {
      id: 'groupObjectIdInput',
      title: 'Group ID (optional)',
      type: 'short-input',
      placeholder: 'Custom group object ID',
      condition: { field: 'operation', value: 'group_objects' },
      mode: 'advanced',
    },
    {
      id: 'ungroupObjectIds',
      title: 'Group Object IDs',
      type: 'short-input',
      placeholder: 'Comma-separated group IDs',
      condition: { field: 'operation', value: 'ungroup_objects' },
      required: true,
    },

    // ========== Create Line Fields ==========
    {
      id: 'linePageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide',
      condition: { field: 'operation', value: 'create_line' },
      required: true,
    },
    {
      id: 'lineCategory',
      title: 'Line Category',
      type: 'dropdown',
      options: [
        { label: 'Straight', id: 'STRAIGHT' },
        { label: 'Bent', id: 'BENT' },
        { label: 'Curved', id: 'CURVED' },
      ],
      value: () => 'STRAIGHT',
      condition: { field: 'operation', value: 'create_line' },
    },
    {
      id: 'lineWidth',
      title: 'Width (pt)',
      type: 'short-input',
      placeholder: 'Default 200',
      condition: { field: 'operation', value: 'create_line' },
    },
    {
      id: 'lineHeight',
      title: 'Height (pt)',
      type: 'short-input',
      placeholder: 'Default 1',
      condition: { field: 'operation', value: 'create_line' },
    },
    {
      id: 'linePositionX',
      title: 'X Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_line' },
    },
    {
      id: 'linePositionY',
      title: 'Y Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_line' },
    },

    // ========== Update Line Properties Fields ==========
    {
      id: 'linePropsObjectId',
      title: 'Line Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_line_properties' },
      required: true,
    },
    {
      id: 'lineColor',
      title: 'Line Color',
      type: 'short-input',
      placeholder: 'Hex',
      condition: { field: 'operation', value: 'update_line_properties' },
    },
    {
      id: 'lineWeight',
      title: 'Line Weight (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_line_properties' },
    },
    {
      id: 'lineDashStyle',
      title: 'Dash Style',
      type: 'short-input',
      placeholder: 'SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },
    {
      id: 'lineStartArrow',
      title: 'Start Arrow',
      type: 'short-input',
      placeholder: 'NONE, STEALTH_ARROW, FILL_ARROW, OPEN_ARROW, ...',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },
    {
      id: 'lineEndArrow',
      title: 'End Arrow',
      type: 'short-input',
      placeholder: 'NONE, STEALTH_ARROW, FILL_ARROW, OPEN_ARROW, ...',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },
    {
      id: 'lineLinkUrl',
      title: 'Link URL',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },
    {
      id: 'linePropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },
    {
      id: 'linePropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. lineFill,weight,dashStyle',
      condition: { field: 'operation', value: 'update_line_properties' },
      mode: 'advanced',
    },

    // ========== Update Line Category Fields ==========
    {
      id: 'lineCategoryObjectId',
      title: 'Line Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_line_category' },
      required: true,
    },
    {
      id: 'newLineCategory',
      title: 'Line Category',
      type: 'dropdown',
      options: [
        { label: 'Straight', id: 'STRAIGHT' },
        { label: 'Bent', id: 'BENT' },
        { label: 'Curved', id: 'CURVED' },
      ],
      condition: { field: 'operation', value: 'update_line_category' },
      required: true,
    },

    // ========== Reroute Line Fields ==========
    {
      id: 'rerouteLineObjectId',
      title: 'Line Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'reroute_line' },
      required: true,
    },

    // ========== Table Row/Column Insert/Delete Fields ==========
    {
      id: 'tableTargetObjectId',
      title: 'Table Object ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
        ],
      },
      required: true,
    },
    {
      id: 'tableCellRowIndex',
      title: 'Cell Row Index',
      type: 'short-input',
      placeholder: 'Zero-based',
      condition: {
        field: 'operation',
        value: [
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
        ],
      },
      required: true,
    },
    {
      id: 'tableCellColumnIndex',
      title: 'Cell Column Index',
      type: 'short-input',
      placeholder: 'Zero-based',
      condition: {
        field: 'operation',
        value: [
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
        ],
      },
      required: true,
    },
    {
      id: 'tableInsertNumber',
      title: 'Number to Insert',
      type: 'short-input',
      placeholder: 'Minimum 1',
      condition: {
        field: 'operation',
        value: ['insert_table_rows', 'insert_table_columns'],
      },
      required: true,
    },
    {
      id: 'tableInsertBelow',
      title: 'Insert Below',
      type: 'switch',
      condition: { field: 'operation', value: 'insert_table_rows' },
    },
    {
      id: 'tableInsertRight',
      title: 'Insert Right',
      type: 'switch',
      condition: { field: 'operation', value: 'insert_table_columns' },
    },

    // ========== Merge / Unmerge / Cell / Border Table Range Fields ==========
    {
      id: 'tableRangeObjectId',
      title: 'Table Object ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ],
      },
      required: true,
    },
    {
      id: 'tableRangeRowIndex',
      title: 'Range Start Row',
      type: 'short-input',
      placeholder: 'Zero-based',
      condition: {
        field: 'operation',
        value: [
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ],
      },
      required: true,
    },
    {
      id: 'tableRangeColumnIndex',
      title: 'Range Start Column',
      type: 'short-input',
      placeholder: 'Zero-based',
      condition: {
        field: 'operation',
        value: [
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ],
      },
      required: true,
    },
    {
      id: 'tableRangeRowSpan',
      title: 'Row Span',
      type: 'short-input',
      placeholder: 'Minimum 1',
      condition: {
        field: 'operation',
        value: [
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ],
      },
      required: true,
    },
    {
      id: 'tableRangeColumnSpan',
      title: 'Column Span',
      type: 'short-input',
      placeholder: 'Minimum 1',
      condition: {
        field: 'operation',
        value: [
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ],
      },
      required: true,
    },

    // ========== Update Table Cell Properties Fields ==========
    {
      id: 'tableCellBackgroundColor',
      title: 'Cell Background Color',
      type: 'short-input',
      placeholder: 'Hex, e.g. #F1F3F4',
      condition: { field: 'operation', value: 'update_table_cell_properties' },
    },
    {
      id: 'tableCellBackgroundAlpha',
      title: 'Background Opacity',
      type: 'short-input',
      placeholder: '0.0 to 1.0',
      condition: { field: 'operation', value: 'update_table_cell_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableCellContentAlignment',
      title: 'Content Alignment',
      type: 'dropdown',
      options: [
        { label: 'Top', id: 'TOP' },
        { label: 'Middle', id: 'MIDDLE' },
        { label: 'Bottom', id: 'BOTTOM' },
      ],
      condition: { field: 'operation', value: 'update_table_cell_properties' },
    },
    {
      id: 'tableCellPropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_table_cell_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableCellPropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. tableCellBackgroundFill,contentAlignment',
      condition: { field: 'operation', value: 'update_table_cell_properties' },
      mode: 'advanced',
    },

    // ========== Update Table Border Properties Fields ==========
    {
      id: 'tableBorderPosition',
      title: 'Border Position',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'ALL' },
        { label: 'Bottom', id: 'BOTTOM' },
        { label: 'Inner', id: 'INNER' },
        { label: 'Inner Horizontal', id: 'INNER_HORIZONTAL' },
        { label: 'Inner Vertical', id: 'INNER_VERTICAL' },
        { label: 'Left', id: 'LEFT' },
        { label: 'Outer', id: 'OUTER' },
        { label: 'Right', id: 'RIGHT' },
        { label: 'Top', id: 'TOP' },
      ],
      value: () => 'ALL',
      condition: { field: 'operation', value: 'update_table_border_properties' },
    },
    {
      id: 'tableBorderColor',
      title: 'Border Color',
      type: 'short-input',
      placeholder: 'Hex',
      condition: { field: 'operation', value: 'update_table_border_properties' },
    },
    {
      id: 'tableBorderWeight',
      title: 'Border Weight (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_table_border_properties' },
    },
    {
      id: 'tableBorderDashStyle',
      title: 'Dash Style',
      type: 'short-input',
      placeholder: 'SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
      condition: { field: 'operation', value: 'update_table_border_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableBorderPropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_table_border_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableBorderPropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. tableBorderFill,weight,dashStyle',
      condition: { field: 'operation', value: 'update_table_border_properties' },
      mode: 'advanced',
    },

    // ========== Update Table Column Properties Fields ==========
    {
      id: 'tableColumnPropsObjectId',
      title: 'Table Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_table_column_properties' },
      required: true,
    },
    {
      id: 'tableColumnIndices',
      title: 'Column Indices',
      type: 'short-input',
      placeholder: 'Comma-separated, zero-based (e.g. "0,2,3")',
      condition: { field: 'operation', value: 'update_table_column_properties' },
      required: true,
    },
    {
      id: 'tableColumnWidth',
      title: 'Column Width (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_table_column_properties' },
    },
    {
      id: 'tableColumnPropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_table_column_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableColumnPropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. columnWidth',
      condition: { field: 'operation', value: 'update_table_column_properties' },
      mode: 'advanced',
    },

    // ========== Update Table Row Properties Fields ==========
    {
      id: 'tableRowPropsObjectId',
      title: 'Table Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_table_row_properties' },
      required: true,
    },
    {
      id: 'tableRowIndices',
      title: 'Row Indices',
      type: 'short-input',
      placeholder: 'Comma-separated, zero-based',
      condition: { field: 'operation', value: 'update_table_row_properties' },
      required: true,
    },
    {
      id: 'tableMinRowHeight',
      title: 'Minimum Row Height (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_table_row_properties' },
    },
    {
      id: 'tableRowPropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_table_row_properties' },
      mode: 'advanced',
    },
    {
      id: 'tableRowPropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. minRowHeight',
      condition: { field: 'operation', value: 'update_table_row_properties' },
      mode: 'advanced',
    },

    // ========== Sheets Chart Embed Fields ==========
    {
      id: 'chartPageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide to embed the chart on',
      condition: { field: 'operation', value: 'create_sheets_chart' },
      required: true,
    },
    {
      id: 'chartSpreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_sheets_chart', 'replace_all_shapes_with_sheets_chart'],
      },
      required: true,
    },
    {
      id: 'chartId',
      title: 'Chart ID',
      type: 'short-input',
      placeholder: 'Numeric chart ID within the spreadsheet',
      condition: {
        field: 'operation',
        value: ['create_sheets_chart', 'replace_all_shapes_with_sheets_chart'],
      },
      required: true,
    },
    {
      id: 'chartLinkingMode',
      title: 'Linking Mode',
      type: 'dropdown',
      options: [
        { label: 'Linked (refreshable)', id: 'LINKED' },
        { label: 'Static Image', id: 'NOT_LINKED_IMAGE' },
      ],
      value: () => 'LINKED',
      condition: {
        field: 'operation',
        value: ['create_sheets_chart', 'replace_all_shapes_with_sheets_chart'],
      },
    },
    {
      id: 'chartWidth',
      title: 'Width (pt)',
      type: 'short-input',
      placeholder: 'Default 400',
      condition: { field: 'operation', value: 'create_sheets_chart' },
    },
    {
      id: 'chartHeight',
      title: 'Height (pt)',
      type: 'short-input',
      placeholder: 'Default 300',
      condition: { field: 'operation', value: 'create_sheets_chart' },
    },
    {
      id: 'chartPositionX',
      title: 'X Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_sheets_chart' },
    },
    {
      id: 'chartPositionY',
      title: 'Y Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_sheets_chart' },
    },

    // ========== Refresh Sheets Chart Fields ==========
    {
      id: 'refreshChartObjectId',
      title: 'Chart Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'refresh_sheets_chart' },
      required: true,
    },

    // ========== Replace All Shapes With Sheets Chart Fields ==========
    {
      id: 'replaceShapesChartFindText',
      title: 'Find Text (Token)',
      type: 'short-input',
      placeholder: 'Shape text token, e.g. {{revenue-chart}}',
      condition: { field: 'operation', value: 'replace_all_shapes_with_sheets_chart' },
      required: true,
    },
    {
      id: 'replaceShapesChartMatchCase',
      title: 'Match Case',
      type: 'switch',
      condition: { field: 'operation', value: 'replace_all_shapes_with_sheets_chart' },
    },
    {
      id: 'replaceShapesChartPageObjectIds',
      title: 'Limit to Slides (IDs)',
      type: 'short-input',
      placeholder: 'Comma-separated slide IDs (empty = all)',
      condition: { field: 'operation', value: 'replace_all_shapes_with_sheets_chart' },
      mode: 'advanced',
    },

    // ========== Create Video Fields ==========
    {
      id: 'videoPageObjectId',
      title: 'Slide ID',
      type: 'short-input',
      placeholder: 'Object ID of the slide',
      condition: { field: 'operation', value: 'create_video' },
      required: true,
    },
    {
      id: 'videoSource',
      title: 'Source',
      type: 'dropdown',
      options: [
        { label: 'YouTube', id: 'YOUTUBE' },
        { label: 'Google Drive', id: 'DRIVE' },
      ],
      value: () => 'YOUTUBE',
      condition: { field: 'operation', value: 'create_video' },
      required: true,
    },
    {
      id: 'videoId',
      title: 'Video ID',
      type: 'short-input',
      placeholder: 'YouTube video ID or Drive file ID',
      condition: { field: 'operation', value: 'create_video' },
      required: true,
    },
    {
      id: 'videoWidth',
      title: 'Width (pt)',
      type: 'short-input',
      placeholder: 'Default 400',
      condition: { field: 'operation', value: 'create_video' },
    },
    {
      id: 'videoHeight',
      title: 'Height (pt)',
      type: 'short-input',
      placeholder: 'Default 225',
      condition: { field: 'operation', value: 'create_video' },
    },
    {
      id: 'videoPositionX',
      title: 'X Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_video' },
    },
    {
      id: 'videoPositionY',
      title: 'Y Position (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_video' },
    },

    // ========== Update Video Properties Fields ==========
    {
      id: 'videoPropsObjectId',
      title: 'Video Object ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_video_properties' },
      required: true,
    },
    {
      id: 'videoAutoPlay',
      title: 'Auto Play',
      type: 'switch',
      condition: { field: 'operation', value: 'update_video_properties' },
    },
    {
      id: 'videoMute',
      title: 'Mute',
      type: 'switch',
      condition: { field: 'operation', value: 'update_video_properties' },
    },
    {
      id: 'videoStart',
      title: 'Start (sec)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_video_properties' },
    },
    {
      id: 'videoEnd',
      title: 'End (sec)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_video_properties' },
    },
    {
      id: 'videoOutlineColor',
      title: 'Outline Color',
      type: 'short-input',
      placeholder: 'Hex',
      condition: { field: 'operation', value: 'update_video_properties' },
      mode: 'advanced',
    },
    {
      id: 'videoOutlineWeight',
      title: 'Outline Weight (pt)',
      type: 'short-input',
      condition: { field: 'operation', value: 'update_video_properties' },
      mode: 'advanced',
    },
    {
      id: 'videoOutlineDashStyle',
      title: 'Outline Dash Style',
      type: 'short-input',
      placeholder: 'SOLID, DOT, DASH, ...',
      condition: { field: 'operation', value: 'update_video_properties' },
      mode: 'advanced',
    },
    {
      id: 'videoPropertiesJson',
      title: 'Properties JSON (advanced)',
      type: 'long-input',
      condition: { field: 'operation', value: 'update_video_properties' },
      mode: 'advanced',
    },
    {
      id: 'videoPropertiesFields',
      title: 'FieldMask (advanced)',
      type: 'short-input',
      placeholder: 'Comma-separated, e.g. autoPlay,mute,start,end',
      condition: { field: 'operation', value: 'update_video_properties' },
      mode: 'advanced',
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
      'google_slides_update_text_style',
      'google_slides_update_paragraph_style',
      'google_slides_delete_text',
      'google_slides_create_paragraph_bullets',
      'google_slides_delete_paragraph_bullets',
      'google_slides_replace_all_shapes_with_image',
      'google_slides_replace_image',
      'google_slides_update_image_properties',
      'google_slides_update_shape_properties',
      'google_slides_update_page_properties',
      'google_slides_update_slide_properties',
      'google_slides_update_page_element_alt_text',
      'google_slides_update_page_element_transform',
      'google_slides_update_page_elements_z_order',
      'google_slides_group_objects',
      'google_slides_ungroup_objects',
      'google_slides_create_line',
      'google_slides_update_line_properties',
      'google_slides_update_line_category',
      'google_slides_reroute_line',
      'google_slides_insert_table_rows',
      'google_slides_insert_table_columns',
      'google_slides_delete_table_row',
      'google_slides_delete_table_column',
      'google_slides_merge_table_cells',
      'google_slides_unmerge_table_cells',
      'google_slides_update_table_cell_properties',
      'google_slides_update_table_border_properties',
      'google_slides_update_table_column_properties',
      'google_slides_update_table_row_properties',
      'google_slides_create_sheets_chart',
      'google_slides_refresh_sheets_chart',
      'google_slides_replace_all_shapes_with_sheets_chart',
      'google_slides_create_video',
      'google_slides_update_video_properties',
      'google_slides_batch_update',
      'google_slides_copy_presentation',
      'google_slides_export_presentation',
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
          case 'update_text_style':
            return 'google_slides_update_text_style'
          case 'update_paragraph_style':
            return 'google_slides_update_paragraph_style'
          case 'delete_text':
            return 'google_slides_delete_text'
          case 'create_paragraph_bullets':
            return 'google_slides_create_paragraph_bullets'
          case 'delete_paragraph_bullets':
            return 'google_slides_delete_paragraph_bullets'
          case 'replace_all_shapes_with_image':
            return 'google_slides_replace_all_shapes_with_image'
          case 'replace_image':
            return 'google_slides_replace_image'
          case 'update_image_properties':
            return 'google_slides_update_image_properties'
          case 'update_shape_properties':
            return 'google_slides_update_shape_properties'
          case 'update_page_properties':
            return 'google_slides_update_page_properties'
          case 'update_slide_properties':
            return 'google_slides_update_slide_properties'
          case 'update_page_element_alt_text':
            return 'google_slides_update_page_element_alt_text'
          case 'update_page_element_transform':
            return 'google_slides_update_page_element_transform'
          case 'update_page_elements_z_order':
            return 'google_slides_update_page_elements_z_order'
          case 'group_objects':
            return 'google_slides_group_objects'
          case 'ungroup_objects':
            return 'google_slides_ungroup_objects'
          case 'create_line':
            return 'google_slides_create_line'
          case 'update_line_properties':
            return 'google_slides_update_line_properties'
          case 'update_line_category':
            return 'google_slides_update_line_category'
          case 'reroute_line':
            return 'google_slides_reroute_line'
          case 'insert_table_rows':
            return 'google_slides_insert_table_rows'
          case 'insert_table_columns':
            return 'google_slides_insert_table_columns'
          case 'delete_table_row':
            return 'google_slides_delete_table_row'
          case 'delete_table_column':
            return 'google_slides_delete_table_column'
          case 'merge_table_cells':
            return 'google_slides_merge_table_cells'
          case 'unmerge_table_cells':
            return 'google_slides_unmerge_table_cells'
          case 'update_table_cell_properties':
            return 'google_slides_update_table_cell_properties'
          case 'update_table_border_properties':
            return 'google_slides_update_table_border_properties'
          case 'update_table_column_properties':
            return 'google_slides_update_table_column_properties'
          case 'update_table_row_properties':
            return 'google_slides_update_table_row_properties'
          case 'create_sheets_chart':
            return 'google_slides_create_sheets_chart'
          case 'refresh_sheets_chart':
            return 'google_slides_refresh_sheets_chart'
          case 'replace_all_shapes_with_sheets_chart':
            return 'google_slides_replace_all_shapes_with_sheets_chart'
          case 'create_video':
            return 'google_slides_create_video'
          case 'update_video_properties':
            return 'google_slides_update_video_properties'
          case 'batch_update':
            return 'google_slides_batch_update'
          case 'copy_presentation':
            return 'google_slides_copy_presentation'
          case 'export_presentation':
            return 'google_slides_export_presentation'
          default:
            throw new Error(`Invalid Google Slides operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
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
          oauthCredential,
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

        const toNum = (v: unknown): number | undefined => {
          if (v === undefined || v === null || v === '') return undefined
          const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
          return Number.isFinite(n) ? n : undefined
        }

        const TEXT_RANGE_OPS = new Set([
          'update_text_style',
          'update_paragraph_style',
          'delete_text',
          'create_paragraph_bullets',
          'delete_paragraph_bullets',
        ])
        if (TEXT_RANGE_OPS.has(params.operation as string)) {
          result.objectId = params.textObjectId
          const rowIdx = toNum(params.textRowIndex)
          const colIdx = toNum(params.textColumnIndex)
          if (rowIdx !== undefined) result.rowIndex = rowIdx
          if (colIdx !== undefined) result.columnIndex = colIdx
          if (params.textRangeType) result.rangeType = params.textRangeType
          const startIdx = toNum(params.textStartIndex)
          const endIdx = toNum(params.textEndIndex)
          if (startIdx !== undefined) result.startIndex = startIdx
          if (endIdx !== undefined) result.endIndex = endIdx
        }

        if (params.operation === 'update_text_style') {
          if (params.textBold !== undefined) result.bold = params.textBold
          if (params.textItalic !== undefined) result.italic = params.textItalic
          if (params.textUnderline !== undefined) result.underline = params.textUnderline
          if (params.textStrikethrough !== undefined)
            result.strikethrough = params.textStrikethrough
          if (params.textSmallCaps !== undefined) result.smallCaps = params.textSmallCaps
          if (params.textFontFamily) result.fontFamily = params.textFontFamily
          const fontSize = toNum(params.textFontSize)
          if (fontSize !== undefined) result.fontSize = fontSize
          if (params.textForegroundColor) result.foregroundColor = params.textForegroundColor
          if (params.textBackgroundColor) result.backgroundColor = params.textBackgroundColor
          if (params.textLinkUrl) result.linkUrl = params.textLinkUrl
          if (params.textBaselineOffset) result.baselineOffset = params.textBaselineOffset
          if (params.textStyleJson) result.styleJson = params.textStyleJson
          if (params.textStyleFields) result.fields = params.textStyleFields
        }

        if (params.operation === 'update_paragraph_style') {
          if (params.paragraphAlignment) result.alignment = params.paragraphAlignment
          const ls = toNum(params.paragraphLineSpacing)
          if (ls !== undefined) result.lineSpacing = ls
          const indentStart = toNum(params.paragraphIndentStart)
          if (indentStart !== undefined) result.indentStart = indentStart
          const indentEnd = toNum(params.paragraphIndentEnd)
          if (indentEnd !== undefined) result.indentEnd = indentEnd
          const indentFirst = toNum(params.paragraphIndentFirstLine)
          if (indentFirst !== undefined) result.indentFirstLine = indentFirst
          const spaceAbove = toNum(params.paragraphSpaceAbove)
          if (spaceAbove !== undefined) result.spaceAbove = spaceAbove
          const spaceBelow = toNum(params.paragraphSpaceBelow)
          if (spaceBelow !== undefined) result.spaceBelow = spaceBelow
          if (params.paragraphDirection) result.direction = params.paragraphDirection
          if (params.paragraphSpacingMode) result.spacingMode = params.paragraphSpacingMode
          if (params.paragraphStyleJson) result.styleJson = params.paragraphStyleJson
          if (params.paragraphStyleFields) result.fields = params.paragraphStyleFields
        }

        if (params.operation === 'create_paragraph_bullets' && params.bulletPreset) {
          result.bulletPreset = params.bulletPreset
        }

        if (params.operation === 'replace_all_shapes_with_image') {
          result.imageUrl = params.replaceShapesImageUrl
          result.findText = params.replaceShapesFindText
          if (params.replaceShapesMatchCase !== undefined)
            result.matchCase = params.replaceShapesMatchCase
          if (params.replaceShapesImageMethod)
            result.imageReplaceMethod = params.replaceShapesImageMethod
          if (params.replaceShapesPageObjectIds)
            result.pageObjectIds = params.replaceShapesPageObjectIds
        }

        if (params.operation === 'replace_image') {
          result.imageObjectId = params.replaceImageObjectId
          result.imageUrl = params.replaceImageUrl
          if (params.replaceImageMethod) result.imageReplaceMethod = params.replaceImageMethod
        }

        if (params.operation === 'update_image_properties') {
          result.objectId = params.imagePropsObjectId
          const brightness = toNum(params.imageBrightness)
          if (brightness !== undefined) result.brightness = brightness
          const contrast = toNum(params.imageContrast)
          if (contrast !== undefined) result.contrast = contrast
          const transparency = toNum(params.imageTransparency)
          if (transparency !== undefined) result.transparency = transparency
          if (params.imageLinkUrl) result.linkUrl = params.imageLinkUrl
          if (params.imageOutlineColor) result.outlineColor = params.imageOutlineColor
          const outlineWeight = toNum(params.imageOutlineWeight)
          if (outlineWeight !== undefined) result.outlineWeight = outlineWeight
          if (params.imageOutlineDashStyle) result.outlineDashStyle = params.imageOutlineDashStyle
          if (params.imagePropertiesJson) result.propertiesJson = params.imagePropertiesJson
          if (params.imagePropertiesFields) result.fields = params.imagePropertiesFields
        }

        if (params.operation === 'update_shape_properties') {
          result.objectId = params.shapePropsObjectId
          if (params.shapeFillColor) result.fillColor = params.shapeFillColor
          const fillAlpha = toNum(params.shapeFillAlpha)
          if (fillAlpha !== undefined) result.fillAlpha = fillAlpha
          if (params.shapeFillUnset !== undefined) result.fillUnset = params.shapeFillUnset
          if (params.shapeOutlineColor) result.outlineColor = params.shapeOutlineColor
          const shapeOutlineWeight = toNum(params.shapeOutlineWeight)
          if (shapeOutlineWeight !== undefined) result.outlineWeight = shapeOutlineWeight
          if (params.shapeOutlineDashStyle) result.outlineDashStyle = params.shapeOutlineDashStyle
          if (params.shapeOutlineUnset !== undefined) result.outlineUnset = params.shapeOutlineUnset
          if (params.shapeLinkUrl) result.linkUrl = params.shapeLinkUrl
          if (params.shapeContentAlignment) result.contentAlignment = params.shapeContentAlignment
          if (params.shapeAutofitType) result.autofitType = params.shapeAutofitType
          if (params.shapePropertiesJson) result.propertiesJson = params.shapePropertiesJson
          if (params.shapePropertiesFields) result.fields = params.shapePropertiesFields
        }

        if (params.operation === 'update_page_properties') {
          result.objectId = params.pagePropsObjectId
          if (params.pageBackgroundColor) result.backgroundColor = params.pageBackgroundColor
          const bgAlpha = toNum(params.pageBackgroundAlpha)
          if (bgAlpha !== undefined) result.backgroundAlpha = bgAlpha
          if (params.pageBackgroundImageUrl)
            result.backgroundImageUrl = params.pageBackgroundImageUrl
          if (params.pageBackgroundUnset !== undefined)
            result.backgroundUnset = params.pageBackgroundUnset
          if (params.pagePropertiesJson) result.propertiesJson = params.pagePropertiesJson
          if (params.pagePropertiesFields) result.fields = params.pagePropertiesFields
        }

        if (params.operation === 'update_slide_properties') {
          result.objectId = params.slidePropsObjectId
          if (params.slideIsSkipped !== undefined) result.isSkipped = params.slideIsSkipped
          if (params.slidePropertiesJson) result.propertiesJson = params.slidePropertiesJson
          if (params.slidePropertiesFields) result.fields = params.slidePropertiesFields
        }

        if (params.operation === 'update_page_element_alt_text') {
          result.objectId = params.altTextObjectId
          if (params.altTextTitle !== undefined) result.title = params.altTextTitle
          if (params.altTextDescription !== undefined)
            result.description = params.altTextDescription
        }

        if (params.operation === 'update_page_element_transform') {
          result.objectId = params.transformObjectId
          const sx = toNum(params.transformScaleX)
          const sy = toNum(params.transformScaleY)
          const shx = toNum(params.transformShearX)
          const shy = toNum(params.transformShearY)
          const tx = toNum(params.transformTranslateX)
          const ty = toNum(params.transformTranslateY)
          if (sx !== undefined) result.scaleX = sx
          if (sy !== undefined) result.scaleY = sy
          if (shx !== undefined) result.shearX = shx
          if (shy !== undefined) result.shearY = shy
          if (tx !== undefined) result.translateX = tx
          if (ty !== undefined) result.translateY = ty
          if (params.transformApplyMode) result.applyMode = params.transformApplyMode
        }

        if (params.operation === 'update_page_elements_z_order') {
          result.objectIds = params.zOrderObjectIds
          // Always overwrite — even when zOrderOperation is empty — so the block-level
          // operation name 'update_page_elements_z_order' can never leak through as the
          // z-order enum value and produce a confusing API error.
          result.operation = params.zOrderOperation || undefined
        }

        if (params.operation === 'group_objects') {
          result.childrenObjectIds = params.groupChildrenObjectIds
          if (params.groupObjectIdInput) result.groupObjectId = params.groupObjectIdInput
        }

        if (params.operation === 'ungroup_objects') {
          result.objectIds = params.ungroupObjectIds
        }

        if (params.operation === 'create_line') {
          result.pageObjectId = params.linePageObjectId
          if (params.lineCategory) result.lineCategory = params.lineCategory
          const lw = toNum(params.lineWidth)
          const lh = toNum(params.lineHeight)
          const lpx = toNum(params.linePositionX)
          const lpy = toNum(params.linePositionY)
          if (lw !== undefined) result.width = lw
          if (lh !== undefined) result.height = lh
          if (lpx !== undefined) result.positionX = lpx
          if (lpy !== undefined) result.positionY = lpy
        }

        if (params.operation === 'update_line_properties') {
          result.objectId = params.linePropsObjectId
          if (params.lineColor) result.lineColor = params.lineColor
          const lineWeight = toNum(params.lineWeight)
          if (lineWeight !== undefined) result.lineWeight = lineWeight
          if (params.lineDashStyle) result.dashStyle = params.lineDashStyle
          if (params.lineStartArrow) result.startArrow = params.lineStartArrow
          if (params.lineEndArrow) result.endArrow = params.lineEndArrow
          if (params.lineLinkUrl) result.linkUrl = params.lineLinkUrl
          if (params.linePropertiesJson) result.propertiesJson = params.linePropertiesJson
          if (params.linePropertiesFields) result.fields = params.linePropertiesFields
        }

        if (params.operation === 'update_line_category') {
          result.objectId = params.lineCategoryObjectId
          if (params.newLineCategory) result.lineCategory = params.newLineCategory
        }

        if (params.operation === 'reroute_line') {
          result.objectId = params.rerouteLineObjectId
        }

        const TABLE_CELL_REF_OPS = new Set([
          'insert_table_rows',
          'insert_table_columns',
          'delete_table_row',
          'delete_table_column',
        ])
        if (TABLE_CELL_REF_OPS.has(params.operation as string)) {
          result.tableObjectId = params.tableTargetObjectId
          const rIdx = toNum(params.tableCellRowIndex)
          const cIdx = toNum(params.tableCellColumnIndex)
          if (rIdx !== undefined) result.rowIndex = rIdx
          if (cIdx !== undefined) result.columnIndex = cIdx
        }
        if (
          params.operation === 'insert_table_rows' ||
          params.operation === 'insert_table_columns'
        ) {
          const n = toNum(params.tableInsertNumber)
          if (n !== undefined) result.number = n
        }
        if (params.operation === 'insert_table_rows' && params.tableInsertBelow !== undefined) {
          result.insertBelow = params.tableInsertBelow
        }
        if (params.operation === 'insert_table_columns' && params.tableInsertRight !== undefined) {
          result.insertRight = params.tableInsertRight
        }

        const TABLE_RANGE_OPS = new Set([
          'merge_table_cells',
          'unmerge_table_cells',
          'update_table_cell_properties',
          'update_table_border_properties',
        ])
        if (TABLE_RANGE_OPS.has(params.operation as string)) {
          result.objectId = params.tableRangeObjectId
          const rIdx = toNum(params.tableRangeRowIndex)
          const cIdx = toNum(params.tableRangeColumnIndex)
          const rSpan = toNum(params.tableRangeRowSpan)
          const cSpan = toNum(params.tableRangeColumnSpan)
          if (rIdx !== undefined) result.rowIndex = rIdx
          if (cIdx !== undefined) result.columnIndex = cIdx
          if (rSpan !== undefined) result.rowSpan = rSpan
          if (cSpan !== undefined) result.columnSpan = cSpan
        }

        if (params.operation === 'update_table_cell_properties') {
          if (params.tableCellBackgroundColor)
            result.backgroundColor = params.tableCellBackgroundColor
          const cellAlpha = toNum(params.tableCellBackgroundAlpha)
          if (cellAlpha !== undefined) result.backgroundAlpha = cellAlpha
          if (params.tableCellContentAlignment)
            result.contentAlignment = params.tableCellContentAlignment
          if (params.tableCellPropertiesJson) result.propertiesJson = params.tableCellPropertiesJson
          if (params.tableCellPropertiesFields) result.fields = params.tableCellPropertiesFields
        }

        if (params.operation === 'update_table_border_properties') {
          if (params.tableBorderPosition) result.borderPosition = params.tableBorderPosition
          if (params.tableBorderColor) result.borderColor = params.tableBorderColor
          const borderWeight = toNum(params.tableBorderWeight)
          if (borderWeight !== undefined) result.borderWeight = borderWeight
          if (params.tableBorderDashStyle) result.dashStyle = params.tableBorderDashStyle
          if (params.tableBorderPropertiesJson)
            result.propertiesJson = params.tableBorderPropertiesJson
          if (params.tableBorderPropertiesFields) result.fields = params.tableBorderPropertiesFields
        }

        if (params.operation === 'update_table_column_properties') {
          result.objectId = params.tableColumnPropsObjectId
          if (params.tableColumnIndices) result.columnIndices = params.tableColumnIndices
          const colWidth = toNum(params.tableColumnWidth)
          if (colWidth !== undefined) result.columnWidth = colWidth
          if (params.tableColumnPropertiesJson)
            result.propertiesJson = params.tableColumnPropertiesJson
          if (params.tableColumnPropertiesFields) result.fields = params.tableColumnPropertiesFields
        }

        if (params.operation === 'update_table_row_properties') {
          result.objectId = params.tableRowPropsObjectId
          if (params.tableRowIndices) result.rowIndices = params.tableRowIndices
          const minHeight = toNum(params.tableMinRowHeight)
          if (minHeight !== undefined) result.minRowHeight = minHeight
          if (params.tableRowPropertiesJson) result.propertiesJson = params.tableRowPropertiesJson
          if (params.tableRowPropertiesFields) result.fields = params.tableRowPropertiesFields
        }

        if (params.operation === 'create_sheets_chart') {
          result.pageObjectId = params.chartPageObjectId
          if (params.chartSpreadsheetId) result.spreadsheetId = params.chartSpreadsheetId
          const cId = toNum(params.chartId)
          if (cId !== undefined) result.chartId = cId
          if (params.chartLinkingMode) result.linkingMode = params.chartLinkingMode
          const cw = toNum(params.chartWidth)
          const ch = toNum(params.chartHeight)
          const cpx = toNum(params.chartPositionX)
          const cpy = toNum(params.chartPositionY)
          if (cw !== undefined) result.width = cw
          if (ch !== undefined) result.height = ch
          if (cpx !== undefined) result.positionX = cpx
          if (cpy !== undefined) result.positionY = cpy
        }

        if (params.operation === 'refresh_sheets_chart') {
          result.objectId = params.refreshChartObjectId
        }

        if (params.operation === 'replace_all_shapes_with_sheets_chart') {
          if (params.chartSpreadsheetId) result.spreadsheetId = params.chartSpreadsheetId
          const cId = toNum(params.chartId)
          if (cId !== undefined) result.chartId = cId
          result.findText = params.replaceShapesChartFindText
          if (params.replaceShapesChartMatchCase !== undefined)
            result.matchCase = params.replaceShapesChartMatchCase
          if (params.chartLinkingMode) result.linkingMode = params.chartLinkingMode
          if (params.replaceShapesChartPageObjectIds)
            result.pageObjectIds = params.replaceShapesChartPageObjectIds
        }

        if (params.operation === 'create_video') {
          result.pageObjectId = params.videoPageObjectId
          if (params.videoSource) result.source = params.videoSource
          if (params.videoId) result.videoId = params.videoId
          const vw = toNum(params.videoWidth)
          const vh = toNum(params.videoHeight)
          const vpx = toNum(params.videoPositionX)
          const vpy = toNum(params.videoPositionY)
          if (vw !== undefined) result.width = vw
          if (vh !== undefined) result.height = vh
          if (vpx !== undefined) result.positionX = vpx
          if (vpy !== undefined) result.positionY = vpy
        }

        if (params.operation === 'update_video_properties') {
          result.objectId = params.videoPropsObjectId
          if (params.videoAutoPlay !== undefined) result.autoPlay = params.videoAutoPlay
          if (params.videoMute !== undefined) result.mute = params.videoMute
          const vStart = toNum(params.videoStart)
          const vEnd = toNum(params.videoEnd)
          if (vStart !== undefined) result.start = vStart
          if (vEnd !== undefined) result.end = vEnd
          if (params.videoOutlineColor) result.outlineColor = params.videoOutlineColor
          const voWeight = toNum(params.videoOutlineWeight)
          if (voWeight !== undefined) result.outlineWeight = voWeight
          if (params.videoOutlineDashStyle) result.outlineDashStyle = params.videoOutlineDashStyle
          if (params.videoPropertiesJson) result.propertiesJson = params.videoPropertiesJson
          if (params.videoPropertiesFields) result.fields = params.videoPropertiesFields
        }

        if (params.operation === 'batch_update') {
          if (params.requestsJson) result.requests = params.requestsJson
          if (params.writeControlJson) result.writeControl = params.writeControlJson
        }

        if (params.operation === 'copy_presentation') {
          if (params.sourcePresentationId) result.sourcePresentationId = params.sourcePresentationId
          if (params.copyTitle) result.title = params.copyTitle
          if (params.copyFolderId) result.folderId = params.copyFolderId
          result.presentationId = undefined
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Slides access token' },
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

    // Copy presentation operation
    sourcePresentationId: { type: 'string', description: 'Source/template presentation ID' },
    copyTitle: { type: 'string', description: 'Title for the copy' },
    copyFolderId: { type: 'string', description: 'Destination folder ID for the copy' },

    // Export presentation operation
    exportFormat: { type: 'string', description: 'Export format (PDF, PPTX, ODP, etc.)' },

    // Batch update (raw)
    requestsJson: { type: 'string', description: 'JSON array of raw Slides API Request objects' },
    writeControlJson: { type: 'string', description: 'WriteControl JSON object' },

    // Replace all shapes with image
    replaceShapesImageUrl: { type: 'string', description: 'Image URL to insert' },
    replaceShapesFindText: { type: 'string', description: 'Text token of shapes to replace' },
    replaceShapesMatchCase: { type: 'boolean', description: 'Match case' },
    replaceShapesImageMethod: { type: 'string', description: 'Image fit method' },
    replaceShapesPageObjectIds: { type: 'string', description: 'Slide IDs to limit to' },

    // Replace image
    replaceImageObjectId: { type: 'string', description: 'Image object ID to replace' },
    replaceImageUrl: { type: 'string', description: 'New image URL' },
    replaceImageMethod: { type: 'string', description: 'Image fit method' },

    // Update image properties
    imagePropsObjectId: { type: 'string', description: 'Image object ID' },
    imageBrightness: { type: 'number', description: 'Brightness -1.0 to 1.0' },
    imageContrast: { type: 'number', description: 'Contrast -1.0 to 1.0' },
    imageTransparency: { type: 'number', description: 'Transparency 0.0 to 1.0' },
    imageLinkUrl: { type: 'string', description: 'Hyperlink URL' },
    imageOutlineColor: { type: 'string', description: 'Outline color (hex)' },
    imageOutlineWeight: { type: 'number', description: 'Outline weight (pt)' },
    imageOutlineDashStyle: { type: 'string', description: 'Outline dash style' },
    imagePropertiesJson: { type: 'string', description: 'Raw ImageProperties JSON' },
    imagePropertiesFields: { type: 'string', description: 'FieldMask' },

    // Shared text range targeting
    textObjectId: { type: 'string', description: 'Object ID for text styling target' },
    textRowIndex: { type: 'number', description: 'Table cell row index' },
    textColumnIndex: { type: 'number', description: 'Table cell column index' },
    textRangeType: { type: 'string', description: 'Range type (ALL/FROM_START_INDEX/FIXED_RANGE)' },
    textStartIndex: { type: 'number', description: 'Range start index' },
    textEndIndex: { type: 'number', description: 'Range end index' },

    // Update text style
    textBold: { type: 'boolean', description: 'Bold' },
    textItalic: { type: 'boolean', description: 'Italic' },
    textUnderline: { type: 'boolean', description: 'Underline' },
    textStrikethrough: { type: 'boolean', description: 'Strikethrough' },
    textSmallCaps: { type: 'boolean', description: 'Small caps' },
    textFontFamily: { type: 'string', description: 'Font family' },
    textFontSize: { type: 'number', description: 'Font size in points' },
    textForegroundColor: { type: 'string', description: 'Text color (hex)' },
    textBackgroundColor: { type: 'string', description: 'Text background color (hex)' },
    textLinkUrl: { type: 'string', description: 'Text hyperlink URL' },
    textBaselineOffset: { type: 'string', description: 'Baseline offset' },
    textStyleJson: { type: 'string', description: 'Raw TextStyle JSON' },
    textStyleFields: { type: 'string', description: 'FieldMask' },

    // Update paragraph style
    paragraphAlignment: { type: 'string', description: 'Paragraph alignment' },
    paragraphLineSpacing: { type: 'number', description: 'Line spacing percent' },
    paragraphIndentStart: { type: 'number', description: 'Indent start (pt)' },
    paragraphIndentEnd: { type: 'number', description: 'Indent end (pt)' },
    paragraphIndentFirstLine: { type: 'number', description: 'First-line indent (pt)' },
    paragraphSpaceAbove: { type: 'number', description: 'Space above (pt)' },
    paragraphSpaceBelow: { type: 'number', description: 'Space below (pt)' },
    paragraphDirection: { type: 'string', description: 'Text direction' },
    paragraphSpacingMode: { type: 'string', description: 'Paragraph spacing mode' },
    paragraphStyleJson: { type: 'string', description: 'Raw ParagraphStyle JSON' },
    paragraphStyleFields: { type: 'string', description: 'FieldMask' },

    // Bullets
    bulletPreset: { type: 'string', description: 'Bullet preset' },

    // Update shape properties
    shapePropsObjectId: { type: 'string', description: 'Shape object ID' },
    shapeFillColor: { type: 'string', description: 'Shape fill color (hex)' },
    shapeFillAlpha: { type: 'number', description: 'Shape fill opacity' },
    shapeFillUnset: { type: 'boolean', description: 'Clear shape fill' },
    shapeOutlineColor: { type: 'string', description: 'Shape outline color (hex)' },
    shapeOutlineWeight: { type: 'number', description: 'Shape outline weight (pt)' },
    shapeOutlineDashStyle: { type: 'string', description: 'Shape outline dash style' },
    shapeOutlineUnset: { type: 'boolean', description: 'Clear shape outline' },
    shapeLinkUrl: { type: 'string', description: 'Shape hyperlink URL' },
    shapeContentAlignment: { type: 'string', description: 'Shape content alignment' },
    shapeAutofitType: { type: 'string', description: 'Shape autofit type' },
    shapePropertiesJson: { type: 'string', description: 'Raw ShapeProperties JSON' },
    shapePropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update page properties
    pagePropsObjectId: { type: 'string', description: 'Slide object ID' },
    pageBackgroundColor: { type: 'string', description: 'Slide background color (hex)' },
    pageBackgroundAlpha: { type: 'number', description: 'Slide background opacity' },
    pageBackgroundImageUrl: { type: 'string', description: 'Slide background image URL' },
    pageBackgroundUnset: { type: 'boolean', description: 'Clear slide background' },
    pagePropertiesJson: { type: 'string', description: 'Raw PageProperties JSON' },
    pagePropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update slide properties
    slidePropsObjectId: { type: 'string', description: 'Slide object ID' },
    slideIsSkipped: { type: 'boolean', description: 'Whether the slide is skipped' },
    slidePropertiesJson: { type: 'string', description: 'Raw SlideProperties JSON' },
    slidePropertiesFields: { type: 'string', description: 'FieldMask' },

    // Alt text
    altTextObjectId: { type: 'string', description: 'Element object ID' },
    altTextTitle: { type: 'string', description: 'Accessibility title' },
    altTextDescription: { type: 'string', description: 'Accessibility description' },

    // Transform
    transformObjectId: { type: 'string', description: 'Element object ID' },
    transformScaleX: { type: 'number', description: 'Scale X' },
    transformScaleY: { type: 'number', description: 'Scale Y' },
    transformShearX: { type: 'number', description: 'Shear X' },
    transformShearY: { type: 'number', description: 'Shear Y' },
    transformTranslateX: { type: 'number', description: 'X position (pt)' },
    transformTranslateY: { type: 'number', description: 'Y position (pt)' },
    transformApplyMode: { type: 'string', description: 'Apply mode' },

    // Z-order
    zOrderObjectIds: { type: 'string', description: 'Comma-separated element IDs' },
    zOrderOperation: { type: 'string', description: 'Z-order operation' },

    // Group / ungroup
    groupChildrenObjectIds: { type: 'string', description: 'Children object IDs' },
    groupObjectIdInput: { type: 'string', description: 'Group object ID' },
    ungroupObjectIds: { type: 'string', description: 'Group object IDs to ungroup' },

    // Create line
    linePageObjectId: { type: 'string', description: 'Slide object ID' },
    lineCategory: { type: 'string', description: 'Line category' },
    lineWidth: { type: 'number', description: 'Line width (pt)' },
    lineHeight: { type: 'number', description: 'Line height (pt)' },
    linePositionX: { type: 'number', description: 'Line X position (pt)' },
    linePositionY: { type: 'number', description: 'Line Y position (pt)' },

    // Update line properties
    linePropsObjectId: { type: 'string', description: 'Line object ID' },
    lineColor: { type: 'string', description: 'Line color (hex)' },
    lineWeight: { type: 'number', description: 'Line weight (pt)' },
    lineDashStyle: { type: 'string', description: 'Line dash style' },
    lineStartArrow: { type: 'string', description: 'Line start arrow' },
    lineEndArrow: { type: 'string', description: 'Line end arrow' },
    lineLinkUrl: { type: 'string', description: 'Line hyperlink URL' },
    linePropertiesJson: { type: 'string', description: 'Raw LineProperties JSON' },
    linePropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update line category
    lineCategoryObjectId: { type: 'string', description: 'Line object ID' },
    newLineCategory: { type: 'string', description: 'New line category' },

    // Reroute line
    rerouteLineObjectId: { type: 'string', description: 'Line object ID' },

    // Table cell-reference ops
    tableTargetObjectId: { type: 'string', description: 'Table object ID' },
    tableCellRowIndex: { type: 'number', description: 'Cell row index' },
    tableCellColumnIndex: { type: 'number', description: 'Cell column index' },
    tableInsertNumber: { type: 'number', description: 'Number of rows/columns to insert' },
    tableInsertBelow: { type: 'boolean', description: 'Insert below reference cell' },
    tableInsertRight: { type: 'boolean', description: 'Insert to the right of reference cell' },

    // Table range ops
    tableRangeObjectId: { type: 'string', description: 'Table object ID' },
    tableRangeRowIndex: { type: 'number', description: 'Range start row' },
    tableRangeColumnIndex: { type: 'number', description: 'Range start column' },
    tableRangeRowSpan: { type: 'number', description: 'Row span' },
    tableRangeColumnSpan: { type: 'number', description: 'Column span' },

    // Update table cell properties
    tableCellBackgroundColor: { type: 'string', description: 'Cell background color (hex)' },
    tableCellBackgroundAlpha: { type: 'number', description: 'Cell background opacity' },
    tableCellContentAlignment: { type: 'string', description: 'Cell content alignment' },
    tableCellPropertiesJson: { type: 'string', description: 'Raw TableCellProperties JSON' },
    tableCellPropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update table border properties
    tableBorderPosition: { type: 'string', description: 'Border position' },
    tableBorderColor: { type: 'string', description: 'Border color (hex)' },
    tableBorderWeight: { type: 'number', description: 'Border weight (pt)' },
    tableBorderDashStyle: { type: 'string', description: 'Border dash style' },
    tableBorderPropertiesJson: { type: 'string', description: 'Raw TableBorderProperties JSON' },
    tableBorderPropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update table column properties
    tableColumnPropsObjectId: { type: 'string', description: 'Table object ID' },
    tableColumnIndices: { type: 'string', description: 'Comma-separated column indices' },
    tableColumnWidth: { type: 'number', description: 'Column width (pt)' },
    tableColumnPropertiesJson: { type: 'string', description: 'Raw TableColumnProperties JSON' },
    tableColumnPropertiesFields: { type: 'string', description: 'FieldMask' },

    // Update table row properties
    tableRowPropsObjectId: { type: 'string', description: 'Table object ID' },
    tableRowIndices: { type: 'string', description: 'Comma-separated row indices' },
    tableMinRowHeight: { type: 'number', description: 'Minimum row height (pt)' },
    tableRowPropertiesJson: { type: 'string', description: 'Raw TableRowProperties JSON' },
    tableRowPropertiesFields: { type: 'string', description: 'FieldMask' },

    // Sheets chart
    chartPageObjectId: { type: 'string', description: 'Slide object ID' },
    chartSpreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
    chartId: { type: 'number', description: 'Chart ID' },
    chartLinkingMode: { type: 'string', description: 'Chart linking mode' },
    chartWidth: { type: 'number', description: 'Chart width (pt)' },
    chartHeight: { type: 'number', description: 'Chart height (pt)' },
    chartPositionX: { type: 'number', description: 'Chart X position (pt)' },
    chartPositionY: { type: 'number', description: 'Chart Y position (pt)' },

    // Refresh sheets chart
    refreshChartObjectId: { type: 'string', description: 'Chart object ID' },

    // Replace all shapes with sheets chart
    replaceShapesChartFindText: { type: 'string', description: 'Text token to replace' },
    replaceShapesChartMatchCase: { type: 'boolean', description: 'Match case' },
    replaceShapesChartPageObjectIds: { type: 'string', description: 'Slide IDs to limit to' },

    // Create video
    videoPageObjectId: { type: 'string', description: 'Slide object ID' },
    videoSource: { type: 'string', description: 'Video source (YOUTUBE or DRIVE)' },
    videoId: { type: 'string', description: 'Video ID' },
    videoWidth: { type: 'number', description: 'Video width (pt)' },
    videoHeight: { type: 'number', description: 'Video height (pt)' },
    videoPositionX: { type: 'number', description: 'Video X position (pt)' },
    videoPositionY: { type: 'number', description: 'Video Y position (pt)' },

    // Update video properties
    videoPropsObjectId: { type: 'string', description: 'Video object ID' },
    videoAutoPlay: { type: 'boolean', description: 'Auto play' },
    videoMute: { type: 'boolean', description: 'Mute' },
    videoStart: { type: 'number', description: 'Playback start (sec)' },
    videoEnd: { type: 'number', description: 'Playback end (sec)' },
    videoOutlineColor: { type: 'string', description: 'Outline color (hex)' },
    videoOutlineWeight: { type: 'number', description: 'Outline weight (pt)' },
    videoOutlineDashStyle: { type: 'string', description: 'Outline dash style' },
    videoPropertiesJson: { type: 'string', description: 'Raw VideoProperties JSON' },
    videoPropertiesFields: { type: 'string', description: 'FieldMask' },
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

    // Generic update outputs (text style, paragraph style, shape/page/slide props, image/line/video props, table props)
    updated: { type: 'boolean', description: 'Whether the operation updated the target' },
    fields: { type: 'string', description: 'FieldMask that was applied' },

    // Copy presentation
    presentationId: { type: 'string', description: 'New presentation ID (copy)' },
    title: { type: 'string', description: 'Presentation title' },

    // Export presentation
    file: { type: 'file', description: 'Stored exported presentation file' },
    contentBase64: { type: 'string', description: 'Base64-encoded exported content' },
    mimeType: { type: 'string', description: 'MIME type of the exported content' },
    sizeBytes: { type: 'number', description: 'Size of the exported content in bytes' },

    // Batch update (raw)
    replies: { type: 'json', description: 'Array of reply objects from batchUpdate' },
    writeControl: { type: 'json', description: 'WriteControl from batchUpdate response' },

    // Image / line / video object IDs
    imageObjectId: { type: 'string', description: 'Image object ID' },
    lineId: { type: 'string', description: 'Line object ID' },
    videoObjectId: { type: 'string', description: 'Video object ID' },
    chartObjectId: { type: 'string', description: 'Sheets chart object ID' },

    // Replace image
    replaced: { type: 'boolean', description: 'Whether the image was replaced' },

    // Group / ungroup
    grouped: { type: 'boolean', description: 'Whether objects were grouped' },
    ungrouped: { type: 'boolean', description: 'Whether objects were ungrouped' },
    groupObjectId: { type: 'string', description: 'Object ID of the resulting group' },
    childrenObjectIds: { type: 'json', description: 'Children IDs of the group' },

    // Z-order
    reordered: { type: 'boolean', description: 'Whether the z-order was changed' },
    objectIds: { type: 'json', description: 'Object IDs affected by the operation' },
    operation: { type: 'string', description: 'Z-order operation applied' },

    // Table extension
    tableObjectId: { type: 'string', description: 'Table object ID affected' },
    number: { type: 'number', description: 'Number of rows/columns inserted' },
    merged: { type: 'boolean', description: 'Whether cells were merged' },
    unmerged: { type: 'boolean', description: 'Whether cells were unmerged' },

    // Sheets chart
    refreshed: { type: 'boolean', description: 'Whether the chart was refreshed' },

    // Line reroute
    rerouted: { type: 'boolean', description: 'Whether the line was rerouted' },

    // Paragraph bullets
    created: { type: 'boolean', description: 'Whether bullets were created' },

    // Bullets / shape / line categories returned
    lineCategory: { type: 'string', description: 'Line category created or updated' },
    shapeType: { type: 'string', description: 'Shape type created' },
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
  integrationType: IntegrationType.Documents,
  tags: ['google-workspace', 'document-processing', 'content-management'],
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
