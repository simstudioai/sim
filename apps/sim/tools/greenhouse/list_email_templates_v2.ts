import type {
  GreenhouseListEmailTemplatesV2Params,
  GreenhouseListEmailTemplatesV2Response,
} from '@/tools/greenhouse/types'
import { EMAIL_TEMPLATES_V2_OUTPUTS, PAGE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  greenhouseListUrl,
  greenhousePagination,
  mapGreenhouseFields,
  readGreenhouseList,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListEmailTemplatesV2Tool: ToolConfig<
  GreenhouseListEmailTemplatesV2Params,
  GreenhouseListEmailTemplatesV2Response
> = {
  id: 'greenhouse_list_email_templates_v2',
  name: 'Greenhouse List Email Templates',
  description: 'Lists one page of email templates with cursor pagination and documented filters.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque nextCursor from the previous page. When set, all other filters and per_page are ignored.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size from 1 to 500 (default 100). Each call retrieves one page.',
    },
    ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids Comma-separated values (maximum 50).',
    },
    created_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Created at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with updated_at.',
    },
    updated_at: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Updated at filter as JSON with gte, lte, gt, lt keys and ISO 8601 values, for example {"gte":"2026-01-01T00:00:00Z"}. Cannot be combined with created_at.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response field names. Omit to return all documented fields. Comma-separated values (maximum 50).',
    },
    email_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email type',
    },
    from_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'From type Allowed: user_email, organization_email, my_email_address, inviter, organizer, not_applicable.',
    },
  },
  request: {
    url: (params) =>
      greenhouseListUrl('email_templates', params, {
        cursor: { type: 'string' },
        per_page: { type: 'integer', minimum: 1, maximum: 500 },
        ids: { type: 'csv', maxItems: 50, integerItems: true },
        created_at: { type: 'object' },
        updated_at: { type: 'object' },
        fields: {
          type: 'csv',
          maxItems: 50,
          enumItems: [
            'body',
            'cc_coordinator',
            'cc_recruiter',
            'created_at',
            'default',
            'description',
            'email_type',
            'from_type',
            'html_body',
            'id',
            'name',
            'office_anywhere',
            'recipients',
            'subject',
            'updated_at',
            'user_id',
          ],
        },
        email_type: {
          type: 'string',
          enum: [
            'candidate_auto_reply',
            'new_candidate',
            'new_internal_candidate',
            'new_referral',
            'new_agency_submission',
            'candidate_hired',
            'approved_to_start_recruiting',
            'offer_fully_approved',
            'job_closed',
            'candidate_rejection',
            'weekly_status',
            'scorecard_reminder',
            'scorecard_repeat_reminder',
            'interviewer_invite',
            'take_home_test_email',
            'daily_recruiting',
            'stage_transition',
            'scorecard_progress',
            'agency_candidate_status',
            'agency_candidate_stage',
            'candidate_email',
            'team_email',
            'none',
            'extending_offer',
            'non_admin_welcome',
            'job_admin_welcome',
            'site_admin_welcome',
            'prospect_referral_receipt',
            'candidate_referral_receipt',
            'candidate_availability_request',
            'candidate_availability_confirmation',
            'approval_request',
            'eeoc_data_request',
            'event_prospect_auto_reply',
            'job_post_request',
            'gdpr_notification',
            'stage_change_for_followers',
            'rejection_for_followers',
            'calendly_request',
            'gdpr_consent_extension',
            'agency_recruiter_assigned',
            'slack_mentions',
            'candidate_self_schedule_request',
            'sourcing_automation_step',
            'candidate_survey',
            'esignature_request',
            'scheduling_link_confirmation',
            'talent_matching_summary',
            'identity_verification_request',
            'identity_verification_daily_digest',
            'candidate_interview_reminder',
            'identity_verification_persona_request',
            'notetaker_consent_request',
            'new_dream_job_applicant',
          ],
        },
        from_type: {
          type: 'string',
          enum: [
            'user_email',
            'organization_email',
            'my_email_address',
            'inviter',
            'organizer',
            'not_applicable',
          ],
        },
      }),
    method: 'GET',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const rows = await readGreenhouseList(response)
    return {
      success: true,
      output: {
        email_templates: rows.map((row) => mapGreenhouseFields(row, EMAIL_TEMPLATES_V2_OUTPUTS)),
        count: rows.length,
        ...greenhousePagination(response),
      },
    }
  },
  outputs: {
    email_templates: {
      type: 'array',
      description: 'email templates on this page',
      items: { type: 'object', properties: { ...EMAIL_TEMPLATES_V2_OUTPUTS } },
    },
    ...PAGE_V2_OUTPUTS,
  },
}
