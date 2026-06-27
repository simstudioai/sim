import { createLogger } from '@sim/logger'
import { MicrosoftOneDriveIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { OneDriveBlockDisplay } from '@/blocks/blocks/onedrive.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { OneDriveResponse } from '@/tools/onedrive/types'
import { normalizeExcelValuesForToolParams } from '@/tools/onedrive/utils'

const logger = createLogger('OneDriveBlock')

export const OneDriveBlock: BlockConfig<OneDriveResponse> = {
  ...OneDriveBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create File', id: 'create_file' },
        { label: 'Upload File', id: 'upload' },
        { label: 'Download File', id: 'download' },
        { label: 'List Files', id: 'list' },
        { label: 'Delete File', id: 'delete' },
      ],
    },
    // One Drive Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'onedrive',
      requiredScopes: getScopesForService('onedrive'),
      placeholder: 'Select Microsoft account',
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
    },
    // Create File Fields
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Name of the file',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
      required: true,
    },
    // File Type selector for create_file operation
    {
      id: 'mimeType',
      title: 'File Type',
      type: 'dropdown',
      options: [
        { label: 'Text File (.txt)', id: 'text/plain' },
        {
          label: 'Excel File (.xlsx)',
          id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
      placeholder: 'Select file type',
      condition: { field: 'operation', value: 'create_file' },
      required: true,
    },
    // Excel values input when creating an .xlsx file
    {
      id: 'values',
      title: 'Values',
      type: 'code',
      language: 'json',
      generationType: 'json-object',
      placeholder: 'Enter a JSON array of rows (e.g., [["A1","B1"],["A2","B2"]])',
      condition: {
        field: 'operation',
        value: 'create_file',
        and: {
          field: 'mimeType',
          value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of arrays that can be written directly into an Excel worksheet.',
        placeholder: 'Describe the table you want to generate...',
        generationType: 'json-object',
      },
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'file',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'upload' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous block (e.g., {{block_1.file}})',
      condition: { field: 'operation', value: 'upload' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'content',
      title: 'Text Content',
      type: 'long-input',
      placeholder: 'Text content for the file',
      condition: {
        field: 'operation',
        value: 'create_file',
        and: {
          field: 'mimeType',
          value: 'text/plain',
        },
      },
      required: true,
    },

    {
      id: 'uploadFolderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'uploadFolderId',
      serviceId: 'onedrive',
      selectorKey: 'onedrive.folders',
      requiredScopes: getScopesForService('onedrive'),
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'uploadManualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'uploadFolderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'folderName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Name for the new folder',
      condition: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'createFolderParentSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'createFolderParentId',
      serviceId: 'onedrive',
      selectorKey: 'onedrive.folders',
      requiredScopes: getScopesForService('onedrive'),
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'createFolderManualParentId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'createFolderParentId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // List Fields - Folder Selector (basic mode)
    {
      id: 'listFolderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      canonicalParamId: 'listFolderId',
      serviceId: 'onedrive',
      selectorKey: 'onedrive.folders',
      requiredScopes: getScopesForService('onedrive'),
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a folder to list files from',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'listManualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'listFolderId',
      placeholder: 'Enter folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search for specific files (e.g., name contains "report")',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'pageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of results (default: 100, max: 1000)',
      condition: { field: 'operation', value: 'list' },
    },
    // Download File Fields - File Selector (basic mode)
    {
      id: 'downloadFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'downloadFileId',
      serviceId: 'onedrive',
      selectorKey: 'onedrive.files',
      requiredScopes: getScopesForService('onedrive'),
      mimeType: 'file', // Exclude folders, show only files
      placeholder: 'Select a file to download',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'download' },
      required: true,
    },
    // Manual File ID input (advanced mode)
    {
      id: 'downloadManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'downloadFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'download' },
      required: true,
    },
    {
      id: 'downloadFileName',
      title: 'File Name Override',
      type: 'short-input',
      placeholder: 'Optional: Override the filename',
      condition: { field: 'operation', value: 'download' },
    },
    // Delete File Fields - File Selector (basic mode)
    {
      id: 'deleteFileSelector',
      title: 'Select File to Delete',
      type: 'file-selector',
      canonicalParamId: 'deleteFileId',
      serviceId: 'onedrive',
      selectorKey: 'onedrive.files',
      requiredScopes: getScopesForService('onedrive'),
      mimeType: 'file', // Exclude folders, show only files
      placeholder: 'Select a file to delete',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Manual File ID input (advanced mode)
    {
      id: 'deleteManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'deleteFileId',
      placeholder: 'Enter file or folder ID to delete',
      mode: 'advanced',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
  ],
  tools: {
    access: [
      'onedrive_upload',
      'onedrive_create_folder',
      'onedrive_download',
      'onedrive_list',
      'onedrive_delete',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            return 'onedrive_upload'
          case 'create_folder':
            return 'onedrive_create_folder'
          case 'download':
            return 'onedrive_download'
          case 'list':
            return 'onedrive_list'
          case 'delete':
            return 'onedrive_delete'
          default:
            throw new Error(`Invalid OneDrive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          // Folder canonical params (per-operation)
          uploadFolderId,
          createFolderParentId,
          listFolderId,
          // File canonical params (per-operation)
          downloadFileId,
          deleteFileId,
          mimeType,
          values,
          downloadFileName,
          file,
          ...rest
        } = params

        let normalizedValues: ReturnType<typeof normalizeExcelValuesForToolParams>
        if (values !== undefined) {
          normalizedValues = normalizeExcelValuesForToolParams(values)
        }

        // Normalize file input from the canonical param
        const normalizedFile = normalizeFileInput(file, { single: true })

        // Resolve folderId based on operation
        let resolvedFolderId: string | undefined
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            resolvedFolderId = uploadFolderId?.trim() || undefined
            break
          case 'create_folder':
            resolvedFolderId = createFolderParentId?.trim() || undefined
            break
          case 'list':
            resolvedFolderId = listFolderId?.trim() || undefined
            break
        }

        // Resolve fileId based on operation
        let resolvedFileId: string | undefined
        switch (params.operation) {
          case 'download':
            resolvedFileId = downloadFileId?.trim() || undefined
            break
          case 'delete':
            resolvedFileId = deleteFileId?.trim() || undefined
            break
        }

        return {
          oauthCredential,
          ...rest,
          values: normalizedValues,
          file: normalizedFile,
          folderId: resolvedFolderId,
          fileId: resolvedFileId,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...(downloadFileName && { fileName: downloadFileName }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Microsoft account credential' },
    // Upload and Create operation inputs
    fileName: { type: 'string', description: 'File name' },
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    content: { type: 'string', description: 'Text content to upload' },
    mimeType: { type: 'string', description: 'MIME type of file to create' },
    values: { type: 'json', description: 'Cell values for new Excel as JSON' },
    // Folder canonical params (per-operation)
    uploadFolderId: { type: 'string', description: 'Parent folder for upload/create file' },
    createFolderParentId: { type: 'string', description: 'Parent folder for create folder' },
    listFolderId: { type: 'string', description: 'Folder to list files from' },
    // File canonical params (per-operation)
    downloadFileId: { type: 'string', description: 'File to download' },
    deleteFileId: { type: 'string', description: 'File to delete' },
    downloadFileName: { type: 'string', description: 'File name override for download' },
    folderName: { type: 'string', description: 'Folder name for create_folder' },
    // List operation inputs
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    deleted: { type: 'boolean', description: 'Whether the file was deleted' },
    fileId: { type: 'string', description: 'The ID of the deleted file' },
    file: {
      type: 'file',
      description: 'The OneDrive file object, including details such as id, name, size, and more.',
    },
    files: {
      type: 'json',
      description:
        'An array of OneDrive file objects, each containing details such as id, name, size, and more.',
    },
  },
}

export const OneDriveBlockMeta = {
  tags: ['microsoft-365', 'cloud', 'document-processing'],
  url: 'https://www.microsoft.com/microsoft-365/onedrive',
  templates: [
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive contract intake',
      prompt:
        'Create a scheduled workflow that polls a OneDrive intake folder for new contract PDFs, extracts clauses with Reducto, writes the structured terms to a table, and pings legal in Teams.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['reducto', 'microsoft_teams'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive sharing audit',
      prompt:
        'Build a scheduled weekly workflow that lists OneDrive files shared externally, flags ones above a sensitivity score, and writes a security review report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive to knowledge base sync',
      prompt:
        'Create a workflow that mirrors OneDrive folders into a knowledge base, chunks and embeds new content on change, and removes deleted files so retrieval stays accurate.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive backup verifier',
      prompt:
        'Build a scheduled workflow that verifies OneDrive backups by sampling files and comparing checksums against the originating SharePoint copy, writing the report to an SRE table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive retention cleaner',
      prompt:
        'Create a scheduled workflow that finds OneDrive files older than the retention horizon, requires manager approval through Teams, and archives or deletes per the policy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive Excel-pipeline opener',
      prompt:
        'Build a scheduled workflow that polls OneDrive for new Excel data drops, normalizes each, writes to a downstream table, and emails the analyst that the latest file is ready.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['microsoft_excel', 'gmail'],
    },
    {
      icon: MicrosoftOneDriveIcon,
      title: 'OneDrive new-hire kit deployer',
      prompt:
        'Create a workflow triggered by a Workday new hire that creates a OneDrive new-hire folder, uploads the standard onboarding documents into it, and writes the folder link into the onboarding tracker.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
  ],
  skills: [
    {
      name: 'upload-file-to-folder',
      description: 'Upload a file to a specific OneDrive folder, creating the folder if needed.',
      content:
        '# Upload File to Folder\n\nPlace a file into the right OneDrive folder.\n\n## Steps\n1. Use List Files to confirm the destination folder exists; if not, run Create Folder.\n2. Run Upload File with the file content and the target folder.\n3. Use a clear, consistent filename so the document is easy to find later.\n\n## Output\nConfirm the uploaded file name, its folder, and the file id or link.',
    },
    {
      name: 'find-and-download-file',
      description: 'Locate a file in OneDrive by name and download its contents.',
      content:
        '# Find and Download File\n\nRetrieve a file from OneDrive for processing.\n\n## Steps\n1. Run List Files in the likely folder to find the file and its id.\n2. Run Download File with the matched file id.\n3. Pass the downloaded content to the next step, such as a parser or summarizer.\n\n## Output\nConfirm the file downloaded with its name and size, and hand off the content.',
    },
    {
      name: 'save-generated-document',
      description:
        'Create a new text or document file in OneDrive from generated content, in the right folder.',
      content:
        '# Save Generated Document\n\nWrite generated content, such as a report or notes, into OneDrive as a new file.\n\n## Steps\n1. Use List Files to confirm the destination folder exists; if not, run Create Folder.\n2. Compose the document content and choose a clear filename and type.\n3. Run Create File with the content, filename, and target folder.\n\n## Output\nConfirm the created file name, its folder, and the file id or link.',
    },
  ],
} as const satisfies BlockMeta
