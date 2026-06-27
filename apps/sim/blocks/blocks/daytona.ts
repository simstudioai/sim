import { DaytonaBlockDisplay } from '@/blocks/blocks/daytona.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

const SANDBOX_SCOPED_OPERATIONS = [
  'execute_command',
  'run_code',
  'upload_file',
  'download_file',
  'list_files',
  'git_clone',
  'get_sandbox',
  'start_sandbox',
  'stop_sandbox',
  'delete_sandbox',
]

export const DaytonaBlock: BlockConfig = {
  ...DaytonaBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Sandbox', id: 'create_sandbox' },
        { label: 'Run Code', id: 'run_code' },
        { label: 'Execute Command', id: 'execute_command' },
        { label: 'Upload File', id: 'upload_file' },
        { label: 'Download File', id: 'download_file' },
        { label: 'List Files', id: 'list_files' },
        { label: 'Git Clone', id: 'git_clone' },
        { label: 'List Sandboxes', id: 'list_sandboxes' },
        { label: 'Get Sandbox', id: 'get_sandbox' },
        { label: 'Start Sandbox', id: 'start_sandbox' },
        { label: 'Stop Sandbox', id: 'stop_sandbox' },
        { label: 'Delete Sandbox', id: 'delete_sandbox' },
      ],
      value: () => 'create_sandbox',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Daytona API key',
      password: true,
      required: true,
    },
    {
      id: 'sandboxId',
      title: 'Sandbox ID',
      type: 'short-input',
      placeholder: 'ID of the sandbox',
      description:
        'Get, start, stop, and delete also accept the sandbox name; all other operations require the ID',
      condition: { field: 'operation', value: SANDBOX_SCOPED_OPERATIONS },
      required: { field: 'operation', value: SANDBOX_SCOPED_OPERATIONS },
    },

    // Create Sandbox fields
    {
      id: 'snapshot',
      title: 'Snapshot',
      type: 'short-input',
      placeholder: 'Snapshot ID or name (uses default if empty)',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'sandboxName',
      title: 'Sandbox Name',
      type: 'short-input',
      placeholder: 'Name for the sandbox',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'envVars',
      title: 'Environment Variables',
      type: 'table',
      columns: ['Key', 'Value'],
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'sandboxLabels',
      title: 'Labels',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'target',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Region for the sandbox (e.g., us, eu)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'sandboxUser',
      title: 'User',
      type: 'short-input',
      placeholder: 'User associated with the sandbox',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'cpu',
      title: 'CPU Cores',
      type: 'short-input',
      placeholder: 'CPU cores to allocate',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'memory',
      title: 'Memory (GB)',
      type: 'short-input',
      placeholder: 'Memory to allocate in GB',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'disk',
      title: 'Disk (GB)',
      type: 'short-input',
      placeholder: 'Disk space to allocate in GB',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'autoStopInterval',
      title: 'Auto-Stop Interval (minutes)',
      type: 'short-input',
      placeholder: 'Auto-stop interval in minutes (0 disables)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'autoArchiveInterval',
      title: 'Auto-Archive Interval (minutes)',
      type: 'short-input',
      placeholder: 'Auto-archive interval in minutes',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'autoDeleteInterval',
      title: 'Auto-Delete Interval (minutes)',
      type: 'short-input',
      placeholder: 'Auto-delete interval in minutes (negative disables)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },
    {
      id: 'isPublic',
      title: 'Public Preview',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_sandbox' },
    },

    // Run Code fields
    {
      id: 'language',
      title: 'Language',
      type: 'dropdown',
      options: [
        { label: 'Python', id: 'python' },
        { label: 'JavaScript', id: 'javascript' },
        { label: 'TypeScript', id: 'typescript' },
      ],
      value: () => 'python',
      condition: { field: 'operation', value: 'run_code' },
    },
    {
      id: 'code',
      title: 'Code',
      type: 'code',
      placeholder: 'Code to run in the sandbox',
      condition: { field: 'operation', value: 'run_code' },
      required: { field: 'operation', value: 'run_code' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate code to run inside an isolated Daytona sandbox in the selected language (Python, JavaScript, or TypeScript). The code runs as a standalone script; print results to stdout. Return ONLY the code without any markdown formatting or explanation.',
        placeholder: 'Describe the code you want to run',
      },
    },

    // Execute Command fields
    {
      id: 'command',
      title: 'Command',
      type: 'long-input',
      placeholder: 'Shell command to execute (e.g., ls -la)',
      rows: 3,
      condition: { field: 'operation', value: 'execute_command' },
      required: { field: 'operation', value: 'execute_command' },
    },
    {
      id: 'cwd',
      title: 'Working Directory',
      type: 'short-input',
      placeholder: 'Working directory for the command',
      mode: 'advanced',
      condition: { field: 'operation', value: 'execute_command' },
    },

    // Shared Run Code / Execute Command fields
    {
      id: 'runEnv',
      title: 'Environment Variables',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['execute_command', 'run_code'] },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: 'Timeout in seconds (defaults to 10)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['execute_command', 'run_code'] },
    },

    // Upload File fields
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file to send to the sandbox',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: 'upload_file' },
      required: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      condition: { field: 'operation', value: 'upload_file' },
      required: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'destinationPath',
      title: 'Destination Path',
      type: 'short-input',
      placeholder: 'Path in the sandbox (trailing slash uploads into directory)',
      condition: { field: 'operation', value: 'upload_file' },
      required: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'uploadFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional file name override',
      mode: 'advanced',
      condition: { field: 'operation', value: 'upload_file' },
    },

    // Download File fields
    {
      id: 'filePath',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'Path of the file in the sandbox',
      condition: { field: 'operation', value: 'download_file' },
      required: { field: 'operation', value: 'download_file' },
    },

    // List Files fields
    {
      id: 'directoryPath',
      title: 'Directory Path',
      type: 'short-input',
      placeholder: 'Directory to list (defaults to working directory)',
      condition: { field: 'operation', value: 'list_files' },
    },

    // Git Clone fields
    {
      id: 'repoUrl',
      title: 'Repository URL',
      type: 'short-input',
      placeholder: 'https://github.com/org/repo.git',
      condition: { field: 'operation', value: 'git_clone' },
      required: { field: 'operation', value: 'git_clone' },
    },
    {
      id: 'clonePath',
      title: 'Clone Path',
      type: 'short-input',
      placeholder: 'Path in the sandbox to clone into',
      condition: { field: 'operation', value: 'git_clone' },
      required: { field: 'operation', value: 'git_clone' },
    },
    {
      id: 'gitBranch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'Branch to clone (defaults to the default branch)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'git_clone' },
    },
    {
      id: 'gitCommitId',
      title: 'Commit',
      type: 'short-input',
      placeholder: 'Specific commit to check out',
      mode: 'advanced',
      condition: { field: 'operation', value: 'git_clone' },
    },
    {
      id: 'gitUsername',
      title: 'Git Username',
      type: 'short-input',
      placeholder: 'Username for private repositories',
      mode: 'advanced',
      condition: { field: 'operation', value: 'git_clone' },
    },
    {
      id: 'gitPassword',
      title: 'Git Password / Token',
      type: 'short-input',
      placeholder: 'Password or access token for private repositories',
      password: true,
      mode: 'advanced',
      condition: { field: 'operation', value: 'git_clone' },
    },

    // List Sandboxes fields
    {
      id: 'nameFilter',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter sandboxes by name prefix',
      condition: { field: 'operation', value: 'list_sandboxes' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum number of sandboxes to return',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_sandboxes' },
    },
    {
      id: 'labelFilter',
      title: 'Label Filter',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_sandboxes' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_sandboxes' },
    },
  ],

  tools: {
    access: [
      'daytona_create_sandbox',
      'daytona_list_sandboxes',
      'daytona_get_sandbox',
      'daytona_start_sandbox',
      'daytona_stop_sandbox',
      'daytona_delete_sandbox',
      'daytona_execute_command',
      'daytona_run_code',
      'daytona_upload_file',
      'daytona_download_file',
      'daytona_list_files',
      'daytona_git_clone',
    ],
    config: {
      tool: (params) => `daytona_${params.operation}`,
      params: (params) => {
        const { operation, apiKey, ...rest } = params

        const baseParams: Record<string, unknown> = { apiKey }

        if (SANDBOX_SCOPED_OPERATIONS.includes(operation)) {
          baseParams.sandboxId = rest.sandboxId
        }

        switch (operation) {
          case 'create_sandbox':
            if (rest.snapshot) baseParams.snapshot = rest.snapshot
            if (rest.sandboxName) baseParams.name = rest.sandboxName
            if (rest.target) baseParams.target = rest.target
            if (rest.sandboxUser) baseParams.user = rest.sandboxUser
            if (rest.envVars) baseParams.env = rest.envVars
            if (rest.sandboxLabels) baseParams.labels = rest.sandboxLabels
            if (rest.cpu !== undefined && rest.cpu !== '') baseParams.cpu = Number(rest.cpu)
            if (rest.memory !== undefined && rest.memory !== '') {
              baseParams.memory = Number(rest.memory)
            }
            if (rest.disk !== undefined && rest.disk !== '') baseParams.disk = Number(rest.disk)
            if (rest.autoStopInterval !== undefined && rest.autoStopInterval !== '') {
              baseParams.autoStopInterval = Number(rest.autoStopInterval)
            }
            if (rest.autoArchiveInterval !== undefined && rest.autoArchiveInterval !== '') {
              baseParams.autoArchiveInterval = Number(rest.autoArchiveInterval)
            }
            if (rest.autoDeleteInterval !== undefined && rest.autoDeleteInterval !== '') {
              baseParams.autoDeleteInterval = Number(rest.autoDeleteInterval)
            }
            if (rest.isPublic != null) baseParams.public = rest.isPublic
            break
          case 'run_code':
            baseParams.code = rest.code
            baseParams.language = rest.language
            if (rest.runEnv) baseParams.env = rest.runEnv
            if (rest.timeout !== undefined && rest.timeout !== '') {
              baseParams.timeout = Number(rest.timeout)
            }
            break
          case 'execute_command':
            baseParams.command = rest.command
            if (rest.cwd) baseParams.cwd = rest.cwd
            if (rest.runEnv) baseParams.env = rest.runEnv
            if (rest.timeout !== undefined && rest.timeout !== '') {
              baseParams.timeout = Number(rest.timeout)
            }
            break
          case 'upload_file': {
            const normalizedFile = normalizeFileInput(rest.file, { single: true })
            if (normalizedFile) baseParams.file = normalizedFile
            baseParams.destinationPath = rest.destinationPath
            if (rest.uploadFileName) baseParams.fileName = rest.uploadFileName
            break
          }
          case 'download_file':
            baseParams.filePath = rest.filePath
            break
          case 'list_files':
            if (rest.directoryPath) baseParams.path = rest.directoryPath
            break
          case 'git_clone':
            baseParams.url = rest.repoUrl
            baseParams.path = rest.clonePath
            if (rest.gitBranch) baseParams.branch = rest.gitBranch
            if (rest.gitCommitId) baseParams.commitId = rest.gitCommitId
            if (rest.gitUsername) baseParams.username = rest.gitUsername
            if (rest.gitPassword) baseParams.password = rest.gitPassword
            break
          case 'list_sandboxes':
            if (rest.nameFilter) baseParams.name = rest.nameFilter
            if (rest.limit) baseParams.limit = Number(rest.limit)
            if (rest.labelFilter) baseParams.labels = rest.labelFilter
            if (rest.cursor) baseParams.cursor = rest.cursor
            break
        }

        return baseParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Daytona API key' },
    sandboxId: {
      type: 'string',
      description:
        'Sandbox ID (get, start, stop, and delete operations also accept the sandbox name)',
    },
    snapshot: { type: 'string', description: 'Snapshot to create the sandbox from' },
    sandboxName: { type: 'string', description: 'Name for the sandbox' },
    target: { type: 'string', description: 'Region for the sandbox' },
    sandboxUser: { type: 'string', description: 'User associated with the sandbox' },
    envVars: { type: 'json', description: 'Environment variables for the sandbox' },
    sandboxLabels: { type: 'json', description: 'Labels for the sandbox' },
    cpu: { type: 'number', description: 'CPU cores to allocate' },
    memory: { type: 'number', description: 'Memory to allocate in GB' },
    disk: { type: 'number', description: 'Disk space to allocate in GB' },
    autoStopInterval: { type: 'number', description: 'Auto-stop interval in minutes' },
    autoArchiveInterval: { type: 'number', description: 'Auto-archive interval in minutes' },
    autoDeleteInterval: { type: 'number', description: 'Auto-delete interval in minutes' },
    isPublic: { type: 'boolean', description: 'Whether the HTTP preview is public' },
    language: { type: 'string', description: 'Language of the code to run' },
    code: { type: 'string', description: 'Code to run in the sandbox' },
    command: { type: 'string', description: 'Shell command to execute' },
    cwd: { type: 'string', description: 'Working directory for the command' },
    runEnv: { type: 'json', description: 'Environment variables for the run' },
    timeout: { type: 'number', description: 'Timeout in seconds' },
    file: { type: 'json', description: 'File to upload to the sandbox' },
    destinationPath: { type: 'string', description: 'Destination path in the sandbox' },
    uploadFileName: { type: 'string', description: 'Optional file name override' },
    filePath: { type: 'string', description: 'Path of the file to download' },
    directoryPath: { type: 'string', description: 'Directory to list' },
    repoUrl: { type: 'string', description: 'URL of the Git repository' },
    clonePath: { type: 'string', description: 'Path to clone the repository into' },
    gitBranch: { type: 'string', description: 'Branch to clone' },
    gitCommitId: { type: 'string', description: 'Commit to check out' },
    gitUsername: { type: 'string', description: 'Username for private repositories' },
    gitPassword: { type: 'string', description: 'Password or token for private repositories' },
    nameFilter: { type: 'string', description: 'Name prefix filter for sandboxes' },
    limit: { type: 'number', description: 'Maximum number of sandboxes to return' },
    labelFilter: { type: 'json', description: 'Label filter for sandboxes' },
    cursor: { type: 'string', description: 'Pagination cursor from a previous response' },
  },

  outputs: {
    sandbox: {
      type: 'json',
      description: 'Sandbox details (create, get, start, stop, delete operations)',
    },
    sandboxes: { type: 'json', description: 'Sandboxes list (list sandboxes operation)' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (list sandboxes operation)',
    },
    exitCode: {
      type: 'number',
      description: 'Exit code (execute command and run code operations)',
    },
    result: {
      type: 'string',
      description: 'Combined stdout/stderr output (execute command and run code operations)',
    },
    artifacts: { type: 'json', description: 'Run artifacts such as charts (run code operation)' },
    uploadedPath: {
      type: 'string',
      description: 'Path of the uploaded file (upload file operation)',
    },
    file: { type: 'file', description: 'Downloaded file (download file operation)' },
    name: {
      type: 'string',
      description: 'File name (upload file and download file operations)',
    },
    mimeType: { type: 'string', description: 'MIME type (download file operation)' },
    size: {
      type: 'number',
      description: 'File size in bytes (upload file and download file operations)',
    },
    files: { type: 'json', description: 'Files at the given path (list files operation)' },
    repoUrl: { type: 'string', description: 'Cloned repository URL (git clone operation)' },
    clonePath: { type: 'string', description: 'Clone destination path (git clone operation)' },
  },
}
