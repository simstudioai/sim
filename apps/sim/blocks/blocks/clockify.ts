import { ClockifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const ClockifyBlock: BlockConfig = {
  type: 'clockify',
  name: 'Clockify',
  description: 'Access Clockify workspaces, users, projects, and member profiles',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Clockify into your workflow. Retrieve workspace details, team members, projects, and member profiles for time tracking management.',
  category: 'tools',
  icon: ClockifyIcon,
  bgColor: '#03A9F4',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Current User', id: 'clockify_get_current_user' },
        { label: 'Get Workspaces', id: 'clockify_get_workspaces' },
        { label: 'Get Workspace Users', id: 'clockify_get_users' },
        { label: 'Get Member Profile', id: 'clockify_get_member_profile' },
        { label: 'Get Projects', id: 'clockify_get_projects' },
      ],
      value: () => 'clockify_get_current_user',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Clockify API key',
      password: true,
      required: true,
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Enter workspace ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['clockify_get_current_user', 'clockify_get_workspaces'],
        not: true,
      },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      required: true,
      condition: {
        field: 'operation',
        value: 'clockify_get_member_profile',
      },
    },
  ],
  tools: {
    access: [
      'clockify_get_current_user',
      'clockify_get_workspaces',
      'clockify_get_users',
      'clockify_get_member_profile',
      'clockify_get_projects',
    ],
    config: {
      tool: (params) => params.operation || 'clockify_get_current_user',
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        switch (params.operation) {
          case 'clockify_get_current_user':
          case 'clockify_get_workspaces':
            return baseParams

          case 'clockify_get_users':
          case 'clockify_get_projects':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
            }

          case 'clockify_get_member_profile':
            return {
              ...baseParams,
              workspaceId: params.workspaceId,
              userId: params.userId,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Clockify API key' },
    workspaceId: { type: 'string', description: 'Workspace ID' },
    userId: { type: 'string', description: 'User ID' },
  },
  outputs: {
    response: { type: 'json', description: 'API response data' },
  },
}

export const ClockifyReportsBlock: BlockConfig = {
  type: 'clockify_reports',
  name: 'Clockify Reports',
  description: 'Generate Clockify time tracking reports',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate summary, detailed, weekly, and attendance reports from Clockify. Filter by date range, users, and projects for comprehensive time tracking analysis.',
  category: 'tools',
  icon: ClockifyIcon,
  bgColor: '#03A9F4',
  subBlocks: [
    {
      id: 'operation',
      title: 'Report Type',
      type: 'dropdown',
      options: [
        { label: 'Summary Report', id: 'clockify_report_summary' },
        { label: 'Detailed Report', id: 'clockify_report_detailed' },
        { label: 'Weekly Report', id: 'clockify_report_weekly' },
        { label: 'Attendance Report', id: 'clockify_report_attendance' },
      ],
      value: () => 'clockify_report_summary',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Clockify API key',
      password: true,
      required: true,
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Enter workspace ID',
      required: true,
    },
    {
      id: 'dateRangeStart',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO8601 (e.g., 2024-01-01T00:00:00Z)',
      required: true,
    },
    {
      id: 'dateRangeEnd',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO8601 (e.g., 2024-01-31T23:59:59Z)',
      required: true,
    },
    {
      id: 'userIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (optional)',
    },
    {
      id: 'projectIds',
      title: 'Project IDs',
      type: 'short-input',
      placeholder: 'Comma-separated project IDs (optional)',
    },
  ],
  tools: {
    access: [
      'clockify_report_summary',
      'clockify_report_detailed',
      'clockify_report_weekly',
      'clockify_report_attendance',
    ],
    config: {
      tool: (params) => params.operation || 'clockify_report_summary',
      params: (params) => ({
        apiKey: params.apiKey,
        workspaceId: params.workspaceId,
        dateRangeStart: params.dateRangeStart,
        dateRangeEnd: params.dateRangeEnd,
        userIds: params.userIds || undefined,
        projectIds: params.projectIds || undefined,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Report type to generate' },
    apiKey: { type: 'string', description: 'Clockify API key' },
    workspaceId: { type: 'string', description: 'Workspace ID' },
    dateRangeStart: { type: 'string', description: 'Start date in ISO8601 format' },
    dateRangeEnd: { type: 'string', description: 'End date in ISO8601 format' },
    userIds: { type: 'string', description: 'Comma-separated user IDs to filter' },
    projectIds: { type: 'string', description: 'Comma-separated project IDs to filter' },
  },
  outputs: {
    response: { type: 'json', description: 'Report data' },
  },
}

export const ClockifyTimeBlock: BlockConfig = {
  type: 'clockify_time',
  name: 'Clockify Time',
  description: 'Access Clockify time entries, timers, time off, and holidays',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Retrieve time entries, in-progress timers, time off requests, and holidays from Clockify for detailed time tracking and absence management.',
  category: 'tools',
  icon: ClockifyIcon,
  bgColor: '#03A9F4',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Time Entries', id: 'clockify_get_time_entries' },
        { label: 'Get Time Entry', id: 'clockify_get_time_entry' },
        { label: 'In-Progress Timers', id: 'clockify_get_in_progress' },
        { label: 'Time Off Requests', id: 'clockify_get_time_off' },
        { label: 'Holidays', id: 'clockify_get_holidays' },
      ],
      value: () => 'clockify_get_time_entries',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Clockify API key',
      password: true,
      required: true,
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Enter workspace ID',
      required: true,
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      required: true,
      condition: {
        field: 'operation',
        value: 'clockify_get_time_entries',
      },
    },
    {
      id: 'timeEntryId',
      title: 'Time Entry ID',
      type: 'short-input',
      placeholder: 'Enter time entry ID',
      required: true,
      condition: {
        field: 'operation',
        value: 'clockify_get_time_entry',
      },
    },
    {
      id: 'start',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO8601 (e.g., 2024-01-01T00:00:00Z)',
      condition: {
        field: 'operation',
        value: ['clockify_get_time_entries', 'clockify_get_time_off', 'clockify_get_holidays'],
      },
    },
    {
      id: 'end',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO8601 (e.g., 2024-01-31T23:59:59Z)',
      condition: {
        field: 'operation',
        value: ['clockify_get_time_entries', 'clockify_get_time_off', 'clockify_get_holidays'],
      },
    },
  ],
  tools: {
    access: [
      'clockify_get_time_entries',
      'clockify_get_time_entry',
      'clockify_get_in_progress',
      'clockify_get_time_off',
      'clockify_get_holidays',
    ],
    config: {
      tool: (params) => params.operation || 'clockify_get_time_entries',
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
          workspaceId: params.workspaceId,
        }

        switch (params.operation) {
          case 'clockify_get_time_entries':
            return {
              ...baseParams,
              userId: params.userId,
              start: params.start || undefined,
              end: params.end || undefined,
            }

          case 'clockify_get_time_entry':
            return {
              ...baseParams,
              timeEntryId: params.timeEntryId,
            }

          case 'clockify_get_in_progress':
            return baseParams

          case 'clockify_get_time_off':
            return {
              ...baseParams,
              start: params.start || undefined,
              end: params.end || undefined,
            }

          case 'clockify_get_holidays':
            return {
              ...baseParams,
              start: params.start || undefined,
              end: params.end || undefined,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Clockify API key' },
    workspaceId: { type: 'string', description: 'Workspace ID' },
    userId: { type: 'string', description: 'User ID' },
    timeEntryId: { type: 'string', description: 'Time entry ID' },
    start: { type: 'string', description: 'Start date in ISO8601 format' },
    end: { type: 'string', description: 'End date in ISO8601 format' },
  },
  outputs: {
    response: { type: 'json', description: 'API response data' },
  },
}
