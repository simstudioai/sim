import { SimLogoIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const simFilesConnectorMeta: ConnectorMeta = {
  id: 'sim_files',
  name: 'Workspace Files',
  description: 'Sync files from this workspace so agents can search their contents',
  version: '1.0.0',
  icon: SimLogoIcon,

  auth: { mode: 'sim' },

  configFields: [
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'selector',
      selectorKey: 'sim.fileFolders',
      canonicalParamId: 'folderId',
      mode: 'basic',
      required: false,
      placeholder: 'All files',
      description: 'Limit the sync to one folder. Leave empty to sync every file in the workspace.',
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      mode: 'advanced',
      required: false,
      placeholder: 'e.g. 8f2c4d1e-…',
    },
    {
      id: 'recursive',
      title: 'Include Subfolders',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      description: 'Defaults to Yes.',
    },
    {
      id: 'extensions',
      title: 'File Types',
      type: 'short-input',
      multi: true,
      required: false,
      placeholder: 'e.g. pdf, docx, md',
      description:
        'Comma-separated extensions. Leave empty to sync every readable type. Files Sim cannot extract text from (images, archives, audio) are never synced.',
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 1000',
      description: 'Caps how many files are indexed. Leave empty for no limit.',
    },
  ],

  /**
   * Deliberately absent. Listing here is one indexed query against a local table, so
   * the usual reason to sync incrementally (an external API's rate limit) does not
   * apply — while `shouldReconcileDeletions` disables deletion reconciliation for any
   * incremental run, and `contentUpdatedAt` advances only on content writes, so
   * renames, moves and deletes would never reach the knowledge base. Content is still
   * only re-fetched when a document's `contentHash` actually changes.
   */
  supportsIncrementalSync: false,

  tagDefinitions: [
    { id: 'folderPath', displayName: 'Folder Path', fieldType: 'text' },
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'uploadedBy', displayName: 'Uploaded By', fieldType: 'text' },
    { id: 'fileSize', displayName: 'File Size', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
