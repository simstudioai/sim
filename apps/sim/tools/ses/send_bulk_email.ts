import type { SESSendBulkEmailParams, SESSendBulkEmailResponse } from '@/tools/ses/types'
import { parseEmailTagsParam } from '@/tools/ses/utils'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const sendBulkEmailTool: InternalToolConfig<
  SESSendBulkEmailParams,
  SESSendBulkEmailResponse
> = {
  id: 'ses_send_bulk_email',
  name: 'SES Send Bulk Email',
  description: 'Send emails to multiple recipients using an SES template with per-recipient data',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
    fromAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Verified sender email address',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the SES email template to use',
    },
    destinations: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of destination objects with toAddresses (string[]), optional ccAddresses and bccAddresses (string[]), and optional templateData (JSON string); templateData falls back to defaultTemplateData when omitted',
    },
    defaultTemplateData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default JSON template data used when a destination does not specify its own',
    },
    replyToAddresses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of reply-to email addresses',
    },
    configurationSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SES configuration set name for tracking',
    },
    fromName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Friendly sender name shown with the From address (e.g., Acme Support)',
    },
    emailTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Default message tags applied to every destination for filtering sending events, as a JSON array of {"name", "value"} objects (letters, digits, _ and - only, up to 256 characters)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      fromAddress: params.fromAddress,
      templateName: params.templateName,
      destinations: params.destinations,
      defaultTemplateData: params.defaultTemplateData,
      configurationSetName: params.configurationSetName,
      replyToAddresses: params.replyToAddresses,
      fromName: params.fromName,
      emailTags: parseEmailTagsParam(params.emailTags),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send bulk email')
    }

    return {
      success: true,
      output: {
        results: data.results ?? [],
        successCount: data.successCount ?? 0,
        failureCount: data.failureCount ?? 0,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Per-destination send results with status and messageId',
    },
    successCount: { type: 'number', description: 'Number of successfully sent emails' },
    failureCount: { type: 'number', description: 'Number of failed email sends' },
  },
}
