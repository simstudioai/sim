import type {
  GreenhouseCreateAttachmentV2Params,
  GreenhouseCreateAttachmentV2Response,
} from '@/tools/greenhouse/types'
import { ATTACHMENTS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseCreateAttachmentV2Tool: ToolConfig<
  GreenhouseCreateAttachmentV2Params,
  GreenhouseCreateAttachmentV2Response
> = {
  id: 'greenhouse_create_attachment_v2',
  name: 'Greenhouse Create Attachment',
  description:
    'Attaches a file to an application. A new resume or cover letter reclassifies the previous attachment of that type as other.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    application_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application ID',
    },
    filename: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Filename',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type Allowed: resume, cover_letter, take_home_test, offer_packet, offer_letter, signed_offer_letter, other, form_attachment, midfunnel_agreement, automated_agreement.',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Base64-encoded attachment content. Supply exactly one of content or url.',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Public attachment URL for Greenhouse to fetch. Supply exactly one of url or content.',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Visibility Allowed: admin_only, private, public.',
    },
  },
  request: {
    url: 'https://harvest.greenhouse.io/v3/attachments',
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          application_id: { type: 'integer', required: true },
          filename: { type: 'string', required: true },
          type: {
            type: 'string',
            enum: [
              'resume',
              'cover_letter',
              'take_home_test',
              'offer_packet',
              'offer_letter',
              'signed_offer_letter',
              'other',
              'form_attachment',
              'midfunnel_agreement',
              'automated_agreement',
            ],
            required: true,
          },
          content: { type: 'string' },
          url: { type: 'string' },
          visibility: { type: 'string', enum: ['admin_only', 'private', 'public'] },
        },
        'create_attachment'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), ATTACHMENTS_V2_OUTPUTS),
  }),
  outputs: { ...ATTACHMENTS_V2_OUTPUTS },
}
