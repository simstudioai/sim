import { AsanaIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AsanaResponse } from '@/tools/asana/types'

export const AsanaBlock: BlockConfig<AsanaResponse> = {
  type: 'asana',
  name: 'Asana',
  description: 'Interact with Asana',
  authMode: AuthMode.OAuth,
  longDescription: 'Integrate Asana into the workflow. Can read, write, and update tasks.',
  docsLink: 'https://docs.sim.ai/integrations/asana',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: AsanaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Task', id: 'get_task' },
        { label: 'Create Task', id: 'create_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Get Projects', id: 'get_projects' },
        { label: 'Search Tasks', id: 'search_tasks' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'Create Subtask', id: 'create_subtask' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'Add Followers', id: 'add_followers' },
        { label: 'Create Project', id: 'create_project' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'List Workspaces', id: 'list_workspaces' },
        { label: 'Create Section', id: 'create_section' },
        { label: 'List Sections', id: 'list_sections' },
      ],
      value: () => 'get_task',
    },
    {
      id: 'credential',
      title: 'Asana Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'asana',
      requiredScopes: getScopesForService('asana'),
      placeholder: 'Select Asana account',
    },
    {
      id: 'manualCredential',
      title: 'Asana Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'project-selector',
      canonicalParamId: 'workspace',
      serviceId: 'asana',
      selectorKey: 'asana.workspaces',
      placeholder: 'Select Asana workspace',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['create_task', 'get_projects', 'search_tasks'],
      },
      required: true,
    },
    {
      id: 'workspace',
      title: 'Workspace GID',
      type: 'short-input',
      canonicalParamId: 'workspace',
      required: true,
      placeholder: 'Enter Asana workspace GID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_task', 'get_projects', 'search_tasks'],
      },
    },
    {
      id: 'taskGid',
      title: 'Task GID',
      type: 'short-input',
      required: false,
      placeholder: 'Leave empty to get all tasks with filters below',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'taskGid',
      title: 'Task GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Asana task GID',
      condition: {
        field: 'operation',
        value: ['update_task', 'add_comment'],
      },
    },
    {
      id: 'getTasksWorkspaceSelector',
      title: 'Workspace',
      type: 'project-selector',
      canonicalParamId: 'getTasks_workspace',
      serviceId: 'asana',
      selectorKey: 'asana.workspaces',
      placeholder: 'Select Asana workspace',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'getTasks_workspace',
      title: 'Workspace GID',
      type: 'short-input',
      canonicalParamId: 'getTasks_workspace',
      placeholder: 'Enter workspace GID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'getTasks_project',
      title: 'Project GID',
      type: 'short-input',

      placeholder: 'Enter project GID',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'getTasks_limit',
      title: 'Limit',
      type: 'short-input',

      placeholder: 'Max tasks to return (default: 50)',
      condition: {
        field: 'operation',
        value: ['get_task'],
      },
    },
    {
      id: 'name',
      title: 'Task Name',
      type: 'short-input',

      required: true,
      placeholder: 'Enter task name',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'notes',
      title: 'Task Notes',
      type: 'long-input',

      placeholder: 'Enter task notes or description',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
    },
    {
      id: 'assignee',
      title: 'Assignee GID',
      type: 'short-input',

      placeholder: 'Enter assignee user GID',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task', 'search_tasks'],
      },
    },
    {
      id: 'due_on',
      title: 'Due Date',
      type: 'short-input',

      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['create_task', 'update_task'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "tomorrow" -> Calculate tomorrow's date in YYYY-MM-DD format
- "next Friday" -> Calculate the next Friday's date in YYYY-MM-DD format
- "in 3 days" -> Calculate 3 days from now in YYYY-MM-DD format
- "end of week" -> Calculate the upcoming Friday or Sunday in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "tomorrow", "next Friday", "in 3 days")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'searchText',
      title: 'Search Text',
      type: 'short-input',

      placeholder: 'Enter search text',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'commentText',
      title: 'Comment Text',
      type: 'long-input',

      required: true,
      placeholder: 'Enter comment text',
      condition: {
        field: 'operation',
        value: ['add_comment'],
      },
    },
    {
      id: 'createProjectWorkspaceSelector',
      title: 'Workspace',
      type: 'project-selector',
      canonicalParamId: 'createProject_workspace',
      serviceId: 'asana',
      selectorKey: 'asana.workspaces',
      placeholder: 'Select Asana workspace',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['create_project'],
      },
      required: true,
    },
    {
      id: 'createProject_workspace',
      title: 'Workspace GID',
      type: 'short-input',
      canonicalParamId: 'createProject_workspace',
      placeholder: 'Enter Asana workspace GID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_project'],
      },
      required: true,
    },
    {
      id: 'projectGid',
      title: 'Project GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Asana project GID',
      condition: {
        field: 'operation',
        value: ['get_project', 'create_section', 'list_sections'],
      },
    },
    {
      id: 'subtaskParentGid',
      title: 'Parent Task GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter parent task GID',
      condition: {
        field: 'operation',
        value: ['create_subtask'],
      },
    },
    {
      id: 'taskGid',
      title: 'Task GID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Asana task GID',
      condition: {
        field: 'operation',
        value: ['delete_task', 'add_followers'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter a name',
      condition: {
        field: 'operation',
        value: ['create_subtask', 'create_project', 'create_section'],
      },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Enter notes or description',
      condition: {
        field: 'operation',
        value: ['create_subtask', 'create_project'],
      },
    },
    {
      id: 'assignee',
      title: 'Assignee GID',
      type: 'short-input',
      placeholder: 'Enter assignee user GID',
      condition: {
        field: 'operation',
        value: ['create_subtask'],
      },
    },
    {
      id: 'due_on',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['create_subtask'],
      },
    },
    {
      id: 'followers',
      title: 'Followers',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated user GIDs (e.g. 12345, 67890)',
      condition: {
        field: 'operation',
        value: ['add_followers'],
      },
    },
    {
      id: 'projects',
      title: 'Projects',
      type: 'short-input',
      placeholder: 'Comma-separated project GIDs to filter by',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['search_tasks'],
      },
    },
    {
      id: 'completed',
      title: 'Completion',
      type: 'checkbox-list',
      options: [{ label: 'Completed', id: 'completed' }],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['update_task', 'search_tasks'],
      },
    },
  ],
  tools: {
    access: [
      'asana_get_task',
      'asana_create_task',
      'asana_update_task',
      'asana_get_projects',
      'asana_search_tasks',
      'asana_add_comment',
      'asana_create_subtask',
      'asana_delete_task',
      'asana_add_followers',
      'asana_create_project',
      'asana_get_project',
      'asana_list_workspaces',
      'asana_create_section',
      'asana_list_sections',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_task':
            return 'asana_get_task'
          case 'create_task':
            return 'asana_create_task'
          case 'update_task':
            return 'asana_update_task'
          case 'get_projects':
            return 'asana_get_projects'
          case 'search_tasks':
            return 'asana_search_tasks'
          case 'add_comment':
            return 'asana_add_comment'
          case 'create_subtask':
            return 'asana_create_subtask'
          case 'delete_task':
            return 'asana_delete_task'
          case 'add_followers':
            return 'asana_add_followers'
          case 'create_project':
            return 'asana_create_project'
          case 'get_project':
            return 'asana_get_project'
          case 'list_workspaces':
            return 'asana_list_workspaces'
          case 'create_section':
            return 'asana_create_section'
          case 'list_sections':
            return 'asana_list_sections'
          default:
            return 'asana_get_task'
        }
      },
      params: (params) => {
        const { oauthCredential, operation } = params

        const projectsArray = params.projects
          ? params.projects
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
          : undefined

        // Only send a completion value when the user actually checked the box; an
        // empty/untouched checkbox must omit the field (not send `false`), so
        // update_task doesn't silently un-complete a task and search_tasks doesn't
        // implicitly filter to incomplete tasks.
        const completedValue =
          Array.isArray(params.completed) && params.completed.length > 0
            ? params.completed.includes('completed')
            : undefined

        const baseParams = {
          accessToken: oauthCredential?.accessToken,
        }

        switch (operation) {
          case 'get_task':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              workspace: params.getTasks_workspace,
              project: params.getTasks_project,
              limit: params.getTasks_limit ? Number(params.getTasks_limit) : undefined,
            }
          case 'create_task':
            return {
              ...baseParams,
              workspace: params.workspace,
              name: params.name,
              notes: params.notes,
              assignee: params.assignee,
              due_on: params.due_on,
            }
          case 'update_task':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              name: params.name,
              notes: params.notes,
              assignee: params.assignee,
              completed: completedValue,
              due_on: params.due_on,
            }
          case 'get_projects':
            return {
              ...baseParams,
              workspace: params.workspace,
            }
          case 'search_tasks':
            return {
              ...baseParams,
              workspace: params.workspace,
              text: params.searchText,
              assignee: params.assignee,
              projects: projectsArray,
              completed: completedValue,
            }
          case 'add_comment':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              text: params.commentText,
            }
          case 'create_subtask':
            return {
              ...baseParams,
              taskGid: params.subtaskParentGid,
              name: params.name,
              notes: params.notes,
              assignee: params.assignee,
              due_on: params.due_on,
            }
          case 'delete_task':
            return {
              ...baseParams,
              taskGid: params.taskGid,
            }
          case 'add_followers':
            return {
              ...baseParams,
              taskGid: params.taskGid,
              followers: params.followers
                ? params.followers
                    .split(',')
                    .map((f: string) => f.trim())
                    .filter((f: string) => f.length > 0)
                : [],
            }
          case 'create_project':
            return {
              ...baseParams,
              workspace: params.createProject_workspace,
              name: params.name,
              notes: params.notes,
            }
          case 'get_project':
            return {
              ...baseParams,
              projectGid: params.projectGid,
            }
          case 'list_workspaces':
            return {
              ...baseParams,
            }
          case 'create_section':
            return {
              ...baseParams,
              projectGid: params.projectGid,
              name: params.name,
            }
          case 'list_sections':
            return {
              ...baseParams,
              projectGid: params.projectGid,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Asana OAuth credential' },
    workspace: { type: 'string', description: 'Workspace GID' },
    taskGid: { type: 'string', description: 'Task GID' },
    getTasks_workspace: { type: 'string', description: 'Workspace GID for getting tasks' },
    getTasks_project: { type: 'string', description: 'Project GID filter for getting tasks' },
    getTasks_limit: { type: 'string', description: 'Limit for getting tasks' },
    name: { type: 'string', description: 'Task name' },
    notes: { type: 'string', description: 'Task notes' },
    assignee: { type: 'string', description: 'Assignee user GID' },
    due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    projects: { type: 'string', description: 'Project GIDs' },
    completed: { type: 'array', description: 'Completion status' },
    searchText: { type: 'string', description: 'Search text' },
    commentText: { type: 'string', description: 'Comment text' },
    createProject_workspace: {
      type: 'string',
      description: 'Workspace GID for creating a project',
    },
    projectGid: { type: 'string', description: 'Project GID' },
    subtaskParentGid: { type: 'string', description: 'Parent task GID for creating a subtask' },
    followers: { type: 'string', description: 'Comma-separated user GIDs to add as followers' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    ts: { type: 'string', description: 'Timestamp of the response' },
    gid: { type: 'string', description: 'Resource globally unique identifier' },
    name: { type: 'string', description: 'Resource name' },
    notes: { type: 'string', description: 'Task notes or description' },
    completed: { type: 'boolean', description: 'Whether the task is completed' },
    text: { type: 'string', description: 'Comment text content' },
    assignee: { type: 'json', description: 'Assignee details (gid, name)' },
    created_by: { type: 'json', description: 'Creator details (gid, name)' },
    due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    modified_at: { type: 'string', description: 'Last modified timestamp' },
    permalink_url: { type: 'string', description: 'URL to the resource in Asana' },
    tasks: { type: 'json', description: 'Array of tasks' },
    projects: { type: 'json', description: 'Array of projects' },
    workspaces: { type: 'json', description: 'Array of workspaces' },
    sections: { type: 'json', description: 'Array of sections' },
    followers: { type: 'json', description: 'Array of followers on the task' },
    archived: { type: 'boolean', description: 'Whether the project is archived' },
    color: { type: 'string', description: 'Project color' },
    deleted: { type: 'boolean', description: 'Whether the task was deleted' },
  },
}

export const AsanaBlockMeta = {
  tags: ['project-management', 'ticketing', 'automation'],
  url: 'https://asana.com',
  templates: [
    {
      icon: AsanaIcon,
      title: 'Asana sprint planner',
      prompt:
        'Build a workflow that on Monday morning compiles uncompleted Asana tasks, rebalances against capacity, and posts the sprint plan to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana stuck-task surfacer',
      prompt:
        'Create a scheduled workflow that finds Asana tasks with no progress for 5+ days, pings the assignee in Slack with a quick-action prompt, and updates the task status based on their answer.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana cross-team blocker watcher',
      prompt:
        'Build a scheduled workflow that searches Asana for tasks tagged blocked, identifies the blocking team based on dependency metadata, and posts a request to the right channel in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana onboarding task launcher',
      prompt:
        'Create a workflow that on a new Salesforce opportunity creates a customer-onboarding Asana task with the right assignee and due date, and writes the task link back to the opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana weekly project digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Asana project progress — completed, in-progress, at-risk — and emails a status update to each project sponsor.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana retro generator',
      prompt:
        'Create a workflow that pulls Asana tasks completed in a sprint, summarizes wins, blockers, and patterns, and writes a retro doc shared with the team via Slack.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana bug intake triager',
      prompt:
        'Build a workflow that searches Asana for newly created tasks in the bug project, classifies each by severity and component with an agent, adds a triage comment, and creates a matching GitHub issue for engineering pickup.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['github'],
    },
  ],
  skills: [
    {
      name: 'create-task-from-request',
      description:
        'Turn an incoming request or message into a well-formed Asana task in the right project with assignee and due date. Use for intake and ticket creation.',
      content:
        '# Create Task from Request\n\nConvert an incoming request into a structured Asana task.\n\n## Steps\n1. Extract the work to be done, the relevant project, an assignee if named, and any due date.\n2. If the project is referenced by name, list projects to resolve its ID.\n3. Create the task with a clear name, a description capturing the request details, the project, assignee, and due date.\n4. Add a comment with any links or source context if helpful.\n\n## Output\nReport the created task name, its URL or ID, project, assignee, and due date.',
    },
    {
      name: 'summarize-project-tasks',
      description:
        'Search tasks in an Asana project and summarize status, overdue items, and who owns what. Use for standups and project status checks.',
      content:
        '# Summarize Project Tasks\n\nProduce a status snapshot of an Asana project.\n\n## Steps\n1. Resolve the project, then search its tasks.\n2. For each task capture name, assignee, due date, and completion state.\n3. Group into completed, in progress, and overdue or due soon.\n4. Note any unassigned tasks or tasks with no due date.\n\n## Output\nA concise status summary: counts per group, overdue tasks called out by name and owner, and any gaps to address.',
    },
    {
      name: 'update-task-status',
      description:
        'Find an Asana task and update its fields — assignee, due date, completion, or add a progress comment. Use to keep tasks current from other systems.',
      content:
        '# Update Task Status\n\nKeep an Asana task in sync with the latest state.\n\n## Steps\n1. Identify the target task by ID, or search to find it by name.\n2. Read the current task to confirm it is the right one.\n3. Update the relevant fields — completion, assignee, or due date.\n4. Add a comment summarizing what changed and why.\n\n## Output\nReport which fields changed and confirm the task ID. If no matching task was found, say so.',
    },
  ],
} as const satisfies BlockMeta
