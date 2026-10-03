import type { SsmGetDocumentParams, SsmGetDocumentResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getDocumentTool: InternalToolConfig<SsmGetDocumentParams, SsmGetDocumentResponse> = {
  id: 'ssm_get_document',
  name: 'SSM Get Document',
  description: 'Read the content of an SSM document or Automation runbook',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the document to read, as returned by ssm_list_documents',
    },
    documentVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document version to read ($LATEST, $DEFAULT, or a version number)',
    },
    versionName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User-defined version name to read',
    },
    documentFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format to return the content in: JSON, YAML, or TEXT',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      name: params.name,
      documentVersion: params.documentVersion,
      versionName: params.versionName,
      documentFormat: params.documentFormat,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get document')
    }

    return {
      success: true,
      output: {
        name: data.name ?? '',
        displayName: data.displayName ?? null,
        createdDate: data.createdDate ?? null,
        versionName: data.versionName ?? null,
        documentVersion: data.documentVersion ?? null,
        status: data.status ?? null,
        statusInformation: data.statusInformation ?? null,
        content: data.content ?? '',
        documentType: data.documentType ?? null,
        documentFormat: data.documentFormat ?? null,
        reviewStatus: data.reviewStatus ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Name of the document',
    },
    displayName: {
      type: 'string',
      description: 'Friendly name of the document',
      optional: true,
    },
    createdDate: {
      type: 'string',
      description: 'When the document was created',
      optional: true,
    },
    versionName: {
      type: 'string',
      description: 'User-defined version name',
      optional: true,
    },
    documentVersion: {
      type: 'string',
      description: 'Document version that was returned',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Document status (Creating, Active, Updating, Deleting, Failed)',
      optional: true,
    },
    statusInformation: {
      type: 'string',
      description: 'Detail about the document status',
      optional: true,
    },
    content: {
      type: 'string',
      description: 'Content of the document in the requested format',
    },
    documentType: {
      type: 'string',
      description:
        'Type of the document (Command, Automation, Policy, Session, and related values)',
      optional: true,
    },
    documentFormat: {
      type: 'string',
      description: 'Format the content is returned in',
      optional: true,
    },
    reviewStatus: {
      type: 'string',
      description: 'Review status of the document (APPROVED, NOT_REVIEWED, PENDING, REJECTED)',
      optional: true,
    },
  },
}
