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
    'Integrate Google Slides into the workflow. Can read, write, and create presentations.',
  docsLink: 'https://docs.sim.ai/tools/google_slides',
  category: 'tools',
  bgColor: '#FFC107',
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
      ],
      value: () => 'read',
    },
    // Google Slides Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-slides',
      requiredScopes: [
        'https://www.googleapis.com/auth/presentations',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google account',
    },
    // Presentation selector (basic mode)
    {
      id: 'presentationId',
      title: 'Select Presentation',
      type: 'file-selector',
      canonicalParamId: 'presentationId',
      serviceId: 'google-slides',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.presentation',
      placeholder: 'Select a presentation',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['read', 'write'] },
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
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    // Slide index for write operation
    {
      id: 'slideIndex',
      title: 'Slide Index',
      type: 'short-input',
      placeholder: 'Enter slide index (0 for first slide)',
      condition: { field: 'operation', value: 'write' },
    },
    // Create-specific Fields
    {
      id: 'title',
      title: 'Presentation Title',
      type: 'short-input',
      placeholder: 'Enter title for the new presentation',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    // Folder selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      serviceId: 'google-slides',
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
    // Content Field for write operation
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter slide content',
      condition: { field: 'operation', value: 'write' },
      required: true,
    },
    // Content Field for create operation
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter slide content',
      condition: { field: 'operation', value: 'create' },
    },
  ],
  tools: {
    access: ['google_slides_read', 'google_slides_write', 'google_slides_create'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_slides_read'
          case 'write':
            return 'google_slides_write'
          case 'create':
            return 'google_slides_create'
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
          ...rest
        } = params

        const effectivePresentationId = (presentationId || manualPresentationId || '').trim()
        const effectiveFolderId = (folderSelector || folderId || '').trim()
        const effectiveSlideIndex = slideIndex
          ? Number.parseInt(slideIndex as string, 10)
          : undefined

        return {
          ...rest,
          presentationId: effectivePresentationId || undefined,
          folderId: effectiveFolderId || undefined,
          slideIndex: effectiveSlideIndex,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Slides access token' },
    presentationId: { type: 'string', description: 'Presentation identifier' },
    manualPresentationId: { type: 'string', description: 'Manual presentation identifier' },
    slideIndex: { type: 'number', description: 'Slide index to write to' },
    title: { type: 'string', description: 'Presentation title' },
    folderSelector: { type: 'string', description: 'Selected folder' },
    folderId: { type: 'string', description: 'Folder identifier' },
    content: { type: 'string', description: 'Slide content' },
  },
  outputs: {
    slides: { type: 'json', description: 'Presentation slides' },
    metadata: { type: 'json', description: 'Presentation metadata' },
    updatedContent: { type: 'boolean', description: 'Content update status' },
  },
}
