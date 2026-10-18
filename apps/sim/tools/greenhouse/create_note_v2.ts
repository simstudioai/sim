import type {
  GreenhouseCreateNoteV2Params,
  GreenhouseCreateNoteV2Response,
} from '@/tools/greenhouse/types'
import { NOTES_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseCreateNoteV2Tool: ToolConfig<
  GreenhouseCreateNoteV2Params,
  GreenhouseCreateNoteV2Response
> = {
  id: 'greenhouse_create_note_v2',
  name: 'Greenhouse Create Note',
  description: 'Creates a candidate note or activity entry, or logs an email without sending it.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    candidate_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate ID whose activity feed receives the note.',
    },
    body: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Body' },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Note subject; required when note_type is EMAIL.',
    },
    note_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Note classification: NOTE, ACTIVITY, or EMAIL. EMAIL logs an email and requires subject, email_from, email_to, and email_cc. Allowed: EMAIL, ACTIVITY, NOTE.',
    },
    user_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID',
    },
    email_from: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of sender addresses, required only when note_type is EMAIL. JSON array of string values.',
    },
    email_to: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of recipient addresses, required only when note_type is EMAIL. JSON array of string values.',
    },
    email_cc: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of CC addresses (may be empty), required only when note_type is EMAIL. JSON array of string values.',
    },
    visibility: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Visibility Allowed: admin_only, private, public.',
    },
    application_id: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application ID',
    },
  },
  request: {
    url: 'https://harvest.greenhouse.io/v3/notes',
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          candidate_id: { type: 'integer', required: true },
          body: { type: 'text', required: true },
          subject: { type: 'text' },
          note_type: { type: 'string', enum: ['EMAIL', 'ACTIVITY', 'NOTE'], required: true },
          user_id: { type: 'integer' },
          email_from: { type: 'array' },
          email_to: { type: 'array' },
          email_cc: { type: 'array' },
          visibility: { type: 'string', enum: ['admin_only', 'private', 'public'], required: true },
          application_id: { type: 'integer' },
        },
        'create_note'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), NOTES_V2_OUTPUTS),
  }),
  outputs: { ...NOTES_V2_OUTPUTS },
}
