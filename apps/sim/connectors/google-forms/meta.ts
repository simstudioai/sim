import { GoogleFormsIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * Hard cap on the number of responses appended to a single form document.
 * Keeps individual documents within a reasonable size for embedding/indexing.
 */
export const MAX_RESPONSES_PER_FORM = 500

export const googleFormsConnectorMeta: ConnectorMeta = {
  id: 'google_forms',
  name: 'Google Forms',
  description: 'Sync Google Forms questions and responses into your knowledge base',
  version: '1.0.0',
  icon: GoogleFormsIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-forms',
    requiredScopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/forms.body',
      'https://www.googleapis.com/auth/forms.responses.readonly',
    ],
  },

  configFields: [
    {
      id: 'folderSelector',
      title: 'Folders',
      type: 'selector',
      selectorKey: 'google.drive',
      mimeType: 'application/vnd.google-apps.folder',
      canonicalParamId: 'folderId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more folders (optional)',
      required: false,
      description: 'Only sync forms inside these Drive folders. Leave blank to sync all forms.',
    },
    {
      id: 'folderId',
      title: 'Folder IDs',
      type: 'short-input',
      canonicalParamId: 'folderId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. 1aBcDeFg…, 2cDeFgHi… (comma-separated for multiple)',
      required: false,
      description: 'Only sync forms inside these Drive folders. Leave blank to sync all forms.',
    },
    {
      id: 'contentScope',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Questions & responses', id: 'both' },
        { label: 'Questions only', id: 'structure' },
      ],
      description: 'Whether to index submitted responses alongside each form’s questions.',
    },
    {
      id: 'maxForms',
      title: 'Max Forms',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 100 (default: unlimited)',
    },
    {
      id: 'maxResponsesPerForm',
      title: 'Max Responses Per Form',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: `e.g. 100 (default: ${MAX_RESPONSES_PER_FORM})`,
      description: 'Cap on responses indexed per form. Applies only when indexing responses.',
    },
  ],

  tagDefinitions: [
    { id: 'formTitle', displayName: 'Form Title', fieldType: 'text' },
    { id: 'owners', displayName: 'Owner', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'lastResponse', displayName: 'Last Response', fieldType: 'date' },
  ],
}
