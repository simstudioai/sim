/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  asanaAddCommentTool,
  asanaAddFollowersTool,
  asanaCreateProjectTool,
  asanaCreateSectionTool,
  asanaCreateSubtaskTool,
  asanaCreateTaskTool,
  asanaDeleteTaskTool,
  asanaGetProjectsTool,
  asanaGetProjectTool,
  asanaGetTaskTool,
  asanaListSectionsTool,
  asanaListWorkspacesTool,
  asanaSearchTasksTool,
  asanaUpdateTaskTool,
} from '@/tools/asana'

const ACCESS_TOKEN = 'access-token'
const AUTH_PARAMS = { accessToken: ACCESS_TOKEN }

const OPERATION_CASES = [
  {
    id: 'asana_add_comment',
    tool: asanaAddCommentTool,
    input: () =>
      asanaAddCommentTool.operation.input({ ...AUTH_PARAMS, taskGid: 'task1', text: 'Comment' }),
    expected: { accessToken: ACCESS_TOKEN, taskGid: 'task1', text: 'Comment' },
  },
  {
    id: 'asana_add_followers',
    tool: asanaAddFollowersTool,
    input: () =>
      asanaAddFollowersTool.operation.input({
        ...AUTH_PARAMS,
        taskGid: 'task1',
        followers: ['user1'],
      }),
    expected: { accessToken: ACCESS_TOKEN, taskGid: 'task1', followers: ['user1'] },
  },
  {
    id: 'asana_create_project',
    tool: asanaCreateProjectTool,
    input: () =>
      asanaCreateProjectTool.operation.input({
        ...AUTH_PARAMS,
        workspace: 'workspace1',
        name: 'Project',
        notes: 'Notes',
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      workspace: 'workspace1',
      name: 'Project',
      notes: 'Notes',
    },
  },
  {
    id: 'asana_create_section',
    tool: asanaCreateSectionTool,
    input: () =>
      asanaCreateSectionTool.operation.input({
        ...AUTH_PARAMS,
        projectGid: 'project1',
        name: 'Section',
      }),
    expected: { accessToken: ACCESS_TOKEN, projectGid: 'project1', name: 'Section' },
  },
  {
    id: 'asana_create_subtask',
    tool: asanaCreateSubtaskTool,
    input: () =>
      asanaCreateSubtaskTool.operation.input({
        ...AUTH_PARAMS,
        taskGid: 'task1',
        name: 'Subtask',
        notes: 'Notes',
        assignee: 'user1',
        due_on: '2026-09-01',
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      taskGid: 'task1',
      name: 'Subtask',
      notes: 'Notes',
      assignee: 'user1',
      due_on: '2026-09-01',
    },
  },
  {
    id: 'asana_create_task',
    tool: asanaCreateTaskTool,
    input: () =>
      asanaCreateTaskTool.operation.input({
        ...AUTH_PARAMS,
        workspace: 'workspace1',
        name: 'Task',
        notes: 'Notes',
        assignee: 'user1',
        due_on: '2026-09-01',
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      workspace: 'workspace1',
      name: 'Task',
      notes: 'Notes',
      assignee: 'user1',
      due_on: '2026-09-01',
    },
  },
  {
    id: 'asana_delete_task',
    tool: asanaDeleteTaskTool,
    input: () => asanaDeleteTaskTool.operation.input({ ...AUTH_PARAMS, taskGid: 'task1' }),
    expected: { accessToken: ACCESS_TOKEN, taskGid: 'task1' },
  },
  {
    id: 'asana_get_project',
    tool: asanaGetProjectTool,
    input: () => asanaGetProjectTool.operation.input({ ...AUTH_PARAMS, projectGid: 'project1' }),
    expected: { accessToken: ACCESS_TOKEN, projectGid: 'project1' },
  },
  {
    id: 'asana_get_projects',
    tool: asanaGetProjectsTool,
    input: () => asanaGetProjectsTool.operation.input({ ...AUTH_PARAMS, workspace: 'workspace1' }),
    expected: { accessToken: ACCESS_TOKEN, workspace: 'workspace1' },
  },
  {
    id: 'asana_get_task',
    tool: asanaGetTaskTool,
    input: () =>
      asanaGetTaskTool.operation.input({
        ...AUTH_PARAMS,
        taskGid: 'task1',
        workspace: 'workspace1',
        project: 'project1',
        limit: 25,
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      taskGid: 'task1',
      workspace: 'workspace1',
      project: 'project1',
      limit: 25,
    },
  },
  {
    id: 'asana_list_sections',
    tool: asanaListSectionsTool,
    input: () => asanaListSectionsTool.operation.input({ ...AUTH_PARAMS, projectGid: 'project1' }),
    expected: { accessToken: ACCESS_TOKEN, projectGid: 'project1' },
  },
  {
    id: 'asana_list_workspaces',
    tool: asanaListWorkspacesTool,
    input: () => asanaListWorkspacesTool.operation.input(AUTH_PARAMS),
    expected: { accessToken: ACCESS_TOKEN },
  },
  {
    id: 'asana_search_tasks',
    tool: asanaSearchTasksTool,
    input: () =>
      asanaSearchTasksTool.operation.input({
        ...AUTH_PARAMS,
        workspace: 'workspace1',
        text: 'urgent',
        assignee: 'user1',
        projects: ['project1'],
        completed: false,
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      workspace: 'workspace1',
      text: 'urgent',
      assignee: 'user1',
      projects: ['project1'],
      completed: false,
    },
  },
  {
    id: 'asana_update_task',
    tool: asanaUpdateTaskTool,
    input: () =>
      asanaUpdateTaskTool.operation.input({
        ...AUTH_PARAMS,
        taskGid: 'task1',
        name: 'Updated',
        notes: 'Notes',
        assignee: 'user1',
        completed: true,
        due_on: '2026-09-01',
      }),
    expected: {
      accessToken: ACCESS_TOKEN,
      taskGid: 'task1',
      name: 'Updated',
      notes: 'Notes',
      assignee: 'user1',
      completed: true,
      due_on: '2026-09-01',
    },
  },
]

describe('Asana operation declarations', () => {
  it.each(OPERATION_CASES)('materializes typed input for $id without HTTP metadata', (testCase) => {
    expect(testCase.tool.id).toBe(testCase.id)
    expect(testCase.tool.request).toBeUndefined()
    expect(testCase.input()).toEqual(testCase.expected)
  })
})
