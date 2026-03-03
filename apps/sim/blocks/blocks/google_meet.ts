import { GoogleMeetIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleMeetResponse } from '@/tools/google_meet/types'

export const GoogleMeetBlock: BlockConfig<GoogleMeetResponse> = {
  type: 'google_meet',
  name: 'Google Meet',
  description: 'Create and manage Google Meet meetings',
  longDescription:
    'Integrate Google Meet into your workflow. Create meeting spaces, get space details, end conferences, list conference records, and view participants.',
  docsLink: 'https://docs.sim.ai/tools/google_meet',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleMeetIcon,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Space', id: 'create_space' },
        { label: 'Get Space', id: 'get_space' },
        { label: 'End Conference', id: 'end_conference' },
        { label: 'List Conference Records', id: 'list_conference_records' },
        { label: 'Get Conference Record', id: 'get_conference_record' },
        { label: 'List Participants', id: 'list_participants' },
      ],
      value: () => 'create_space',
    },
    {
      id: 'credential',
      title: 'Google Meet Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-meet',
      requiredScopes: [
        'https://www.googleapis.com/auth/meetings.space.created',
        'https://www.googleapis.com/auth/meetings.space.readonly',
      ],
      placeholder: 'Select Google Meet account',
    },
    {
      id: 'manualCredential',
      title: 'Google Meet Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Create Space Fields
    {
      id: 'accessType',
      title: 'Access Type',
      type: 'dropdown',
      condition: { field: 'operation', value: 'create_space' },
      options: [
        { label: 'Open (anyone with link)', id: 'OPEN' },
        { label: 'Trusted (organization members)', id: 'TRUSTED' },
        { label: 'Restricted (invited only)', id: 'RESTRICTED' },
      ],
    },
    {
      id: 'entryPointAccess',
      title: 'Entry Point Access',
      type: 'dropdown',
      condition: { field: 'operation', value: 'create_space' },
      mode: 'advanced',
      options: [
        { label: 'All entry points', id: 'ALL' },
        { label: 'Creator app only', id: 'CREATOR_APP_ONLY' },
      ],
    },

    // Get Space / End Conference Fields
    {
      id: 'spaceName',
      title: 'Space Name or Meeting Code',
      type: 'short-input',
      placeholder: 'spaces/abc123 or abc-defg-hij',
      condition: { field: 'operation', value: ['get_space', 'end_conference'] },
      required: { field: 'operation', value: ['get_space', 'end_conference'] },
    },

    // Conference Record Fields
    {
      id: 'conferenceName',
      title: 'Conference Record Name',
      type: 'short-input',
      placeholder: 'conferenceRecords/abc123',
      condition: { field: 'operation', value: ['get_conference_record', 'list_participants'] },
      required: { field: 'operation', value: ['get_conference_record', 'list_participants'] },
    },

    // List Conference Records Fields
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'space.name = "spaces/abc123"',
      condition: { field: 'operation', value: ['list_conference_records', 'list_participants'] },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: ['list_conference_records', 'list_participants'] },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from previous request',
      condition: { field: 'operation', value: ['list_conference_records', 'list_participants'] },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'google_meet_create_space',
      'google_meet_get_space',
      'google_meet_end_conference',
      'google_meet_list_conference_records',
      'google_meet_get_conference_record',
      'google_meet_list_participants',
    ],
    config: {
      tool: (params) => `google_meet_${params.operation}`,
      params: (params) => {
        const { oauthCredential, operation, pageSize, ...rest } = params

        const processedParams: Record<string, unknown> = { ...rest }

        if (pageSize) {
          processedParams.pageSize =
            typeof pageSize === 'string' ? Number.parseInt(pageSize, 10) : pageSize
        }

        return {
          oauthCredential,
          ...processedParams,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Meet access token' },
    accessType: { type: 'string', description: 'Access type for meeting space' },
    entryPointAccess: { type: 'string', description: 'Entry point access setting' },
    spaceName: { type: 'string', description: 'Space resource name or meeting code' },
    conferenceName: { type: 'string', description: 'Conference record resource name' },
    filter: { type: 'string', description: 'Filter expression' },
    pageSize: { type: 'string', description: 'Maximum results per page' },
    pageToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    name: { type: 'string', description: 'Resource name' },
    meetingUri: { type: 'string', description: 'Meeting URL' },
    meetingCode: { type: 'string', description: 'Meeting code' },
    accessType: { type: 'string', description: 'Access type' },
    entryPointAccess: { type: 'string', description: 'Entry point access' },
    activeConference: { type: 'string', description: 'Active conference record' },
    ended: { type: 'boolean', description: 'Whether conference was ended' },
    conferenceRecords: { type: 'json', description: 'List of conference records' },
    startTime: { type: 'string', description: 'Conference start time' },
    endTime: { type: 'string', description: 'Conference end time' },
    expireTime: { type: 'string', description: 'Record expiration time' },
    space: { type: 'string', description: 'Associated space name' },
    participants: { type: 'json', description: 'List of participants' },
    nextPageToken: { type: 'string', description: 'Next page token' },
    totalSize: { type: 'number', description: 'Total participant count' },
  },
}
