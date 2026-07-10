import { ClipboardList, Download, File, Search, Server, Wrench } from '@sim/emcn/icons'
import { SshIcon, SshTerminalIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SSHResponse } from '@/tools/ssh/types'

export const SSHBlock: BlockConfig<SSHResponse> = {
  type: 'ssh',
  name: 'SSH',
  description: 'Connect to remote servers via SSH',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Execute commands, transfer files, and manage remote servers via SSH. Supports password and private key authentication for secure server access.',
  docsLink: 'https://docs.sim.ai/integrations/ssh',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#000000',
  icon: SshIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Execute Command', id: 'ssh_execute_command' },
        { label: 'Execute Script', id: 'ssh_execute_script' },
        { label: 'Check Command Exists', id: 'ssh_check_command_exists' },
        { label: 'Upload File', id: 'ssh_upload_file' },
        { label: 'Download File', id: 'ssh_download_file' },
        { label: 'List Directory', id: 'ssh_list_directory' },
        { label: 'Check File/Directory Exists', id: 'ssh_check_file_exists' },
        { label: 'Create Directory', id: 'ssh_create_directory' },
        { label: 'Delete File/Directory', id: 'ssh_delete_file' },
        { label: 'Move/Rename', id: 'ssh_move_rename' },
        { label: 'Get System Info', id: 'ssh_get_system_info' },
        { label: 'Read File Content', id: 'ssh_read_file_content' },
        { label: 'Write File Content', id: 'ssh_write_file_content' },
      ],
      value: () => 'ssh_execute_command',
    },

    // Connection parameters
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'example.com or 192.168.1.100',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '22',
      value: () => '22',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'ubuntu, root, or deploy',
      required: true,
    },

    // Authentication method selector
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'Password', id: 'password' },
        { label: 'Private Key', id: 'privateKey' },
      ],
      value: () => 'password',
    },

    // Password authentication
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your SSH password',
      condition: { field: 'authMethod', value: 'password' },
      dependsOn: ['authMethod'],
    },

    // Private key authentication
    {
      id: 'privateKey',
      title: 'Private Key',
      type: 'code',
      placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
      condition: { field: 'authMethod', value: 'privateKey' },
      dependsOn: ['authMethod'],
    },
    {
      id: 'passphrase',
      title: 'Passphrase',
      type: 'short-input',
      password: true,
      placeholder: 'Passphrase for encrypted key (optional)',
      condition: { field: 'authMethod', value: 'privateKey' },
      dependsOn: ['authMethod'],
    },

    // EXECUTE COMMAND
    {
      id: 'command',
      title: 'Command',
      type: 'code',
      placeholder: 'ls -la /var/www',
      required: true,
      condition: { field: 'operation', value: 'ssh_execute_command' },
      wandConfig: {
        enabled: true,
        prompt: `You are an expert Linux/Unix system administrator.
Generate a shell command or commands based on the user's request for SSH execution on a remote server.

Current command: {context}

RULES:
1. Generate ONLY the raw shell command(s) - no markdown, no explanations, no code blocks
2. Use standard Unix/Linux commands that work on most systems
3. For multiple commands, separate with && or ; as appropriate
4. Prefer safe, non-destructive commands when possible
5. Use proper quoting for paths with spaces
6. Consider common shell utilities: ls, cat, grep, find, awk, sed, tar, curl, wget, systemctl, etc.

Examples:
- "list files" → ls -la
- "find large files" → find . -type f -size +100M
- "check disk space" → df -h
- "show running processes" → ps aux
- "restart nginx" → sudo systemctl restart nginx`,
      },
    },
    {
      id: 'workingDirectory',
      title: 'Working Directory',
      type: 'short-input',
      placeholder: '/var/www/html (optional)',
      condition: { field: 'operation', value: 'ssh_execute_command' },
    },

    // EXECUTE SCRIPT
    {
      id: 'script',
      title: 'Script Content',
      type: 'code',
      placeholder: '#!/bin/bash\necho "Hello World"',
      required: true,
      condition: { field: 'operation', value: 'ssh_execute_script' },
      wandConfig: {
        enabled: true,
        prompt: `You are an expert shell script writer.
Generate a complete shell script based on the user's request for SSH execution on a remote server.

Current script: {context}

RULES:
1. Generate ONLY the raw script content - no markdown, no explanations, no code blocks
2. Include appropriate shebang (#!/bin/bash) at the start
3. Use proper error handling where appropriate (set -e, set -o pipefail)
4. Add comments for complex logic
5. Use variables for repeated values
6. Handle edge cases gracefully
7. Make scripts portable across common Linux distributions

Examples:
- "backup script" → #!/bin/bash\\nset -e\\ntar -czf backup-$(date +%Y%m%d).tar.gz /var/www
- "deploy script" → #!/bin/bash\\nset -e\\ngit pull origin main\\nnpm install\\npm run build\\nsystemctl restart app`,
      },
    },
    {
      id: 'interpreter',
      title: 'Interpreter',
      type: 'short-input',
      placeholder: '/bin/bash',
      condition: { field: 'operation', value: 'ssh_execute_script' },
    },
    {
      id: 'scriptWorkingDirectory',
      title: 'Working Directory',
      type: 'short-input',
      placeholder: '/var/www/html (optional)',
      condition: { field: 'operation', value: 'ssh_execute_script' },
    },

    // CHECK COMMAND EXISTS
    {
      id: 'commandName',
      title: 'Command Name',
      type: 'short-input',
      placeholder: 'docker, git, python3',
      required: true,
      condition: { field: 'operation', value: 'ssh_check_command_exists' },
    },

    // UPLOAD FILE
    {
      id: 'fileContent',
      title: 'File Content',
      type: 'code',
      placeholder: 'Content to upload...',
      required: true,
      condition: { field: 'operation', value: 'ssh_upload_file' },
      wandConfig: {
        enabled: true,
        prompt: `You are an expert at generating configuration files and file content for server deployment.
Generate file content based on the user's request for uploading to a remote server via SSH.

Current content: {context}

RULES:
1. Generate ONLY the raw file content - no markdown, no explanations, no code blocks
2. Use proper formatting for the file type (JSON, YAML, INI, etc.)
3. Include helpful comments where appropriate for config files
4. Use sensible defaults and best practices
5. Ensure valid syntax for the file format

Examples:
- "nginx config" → server { listen 80; server_name example.com; ... }
- "json config" → { "key": "value", "port": 3000 }
- "env file" → NODE_ENV=production\\nPORT=3000\\nDATABASE_URL=...`,
      },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'config.json',
      required: true,
      condition: { field: 'operation', value: 'ssh_upload_file' },
    },
    {
      id: 'remotePath',
      title: 'Remote Path',
      type: 'short-input',
      placeholder: '/var/www/html/config.json',
      required: true,
      condition: { field: 'operation', value: 'ssh_upload_file' },
    },
    {
      id: 'permissions',
      title: 'Permissions',
      type: 'short-input',
      placeholder: '0644',
      condition: { field: 'operation', value: 'ssh_upload_file' },
    },

    // DOWNLOAD FILE
    {
      id: 'downloadRemotePath',
      title: 'Remote File Path',
      type: 'short-input',
      placeholder: '/var/log/app.log',
      required: true,
      condition: { field: 'operation', value: 'ssh_download_file' },
    },

    // LIST DIRECTORY
    {
      id: 'listPath',
      title: 'Directory Path',
      type: 'short-input',
      placeholder: '/var/www',
      required: true,
      condition: { field: 'operation', value: 'ssh_list_directory' },
    },
    {
      id: 'detailed',
      title: 'Show Details',
      type: 'switch',
      condition: { field: 'operation', value: 'ssh_list_directory' },
    },

    // CHECK FILE EXISTS
    {
      id: 'checkPath',
      title: 'Path to Check',
      type: 'short-input',
      placeholder: '/etc/nginx/nginx.conf',
      required: true,
      condition: { field: 'operation', value: 'ssh_check_file_exists' },
    },
    {
      id: 'checkType',
      title: 'Expected Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'File', id: 'file' },
        { label: 'Directory', id: 'directory' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'ssh_check_file_exists' },
    },

    // CREATE DIRECTORY
    {
      id: 'createPath',
      title: 'Directory Path',
      type: 'short-input',
      placeholder: '/var/www/new-site',
      required: true,
      condition: { field: 'operation', value: 'ssh_create_directory' },
    },
    {
      id: 'recursive',
      title: 'Create Parent Directories',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'ssh_create_directory' },
    },

    // DELETE FILE
    {
      id: 'deletePath',
      title: 'Path to Delete',
      type: 'short-input',
      placeholder: '/tmp/old-file.txt',
      required: true,
      condition: { field: 'operation', value: 'ssh_delete_file' },
    },
    {
      id: 'deleteRecursive',
      title: 'Recursive Delete',
      type: 'switch',
      condition: { field: 'operation', value: 'ssh_delete_file' },
    },
    {
      id: 'force',
      title: 'Force Delete',
      type: 'switch',
      condition: { field: 'operation', value: 'ssh_delete_file' },
    },

    // MOVE/RENAME
    {
      id: 'sourcePath',
      title: 'Source Path',
      type: 'short-input',
      placeholder: '/var/www/old-name',
      required: true,
      condition: { field: 'operation', value: 'ssh_move_rename' },
    },
    {
      id: 'destinationPath',
      title: 'Destination Path',
      type: 'short-input',
      placeholder: '/var/www/new-name',
      required: true,
      condition: { field: 'operation', value: 'ssh_move_rename' },
    },
    {
      id: 'overwrite',
      title: 'Overwrite if Exists',
      type: 'switch',
      condition: { field: 'operation', value: 'ssh_move_rename' },
    },

    // READ FILE CONTENT
    {
      id: 'readPath',
      title: 'File Path',
      type: 'short-input',
      placeholder: '/var/log/app.log',
      required: true,
      condition: { field: 'operation', value: 'ssh_read_file_content' },
    },
    {
      id: 'encoding',
      title: 'Encoding',
      type: 'short-input',
      placeholder: 'utf-8',
      condition: { field: 'operation', value: 'ssh_read_file_content' },
    },
    {
      id: 'maxSize',
      title: 'Max Size (MB)',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'ssh_read_file_content' },
    },

    // WRITE FILE CONTENT
    {
      id: 'writePath',
      title: 'File Path',
      type: 'short-input',
      placeholder: '/etc/config.json',
      required: true,
      condition: { field: 'operation', value: 'ssh_write_file_content' },
    },
    {
      id: 'content',
      title: 'File Content',
      type: 'code',
      placeholder: 'Content to write...',
      required: true,
      condition: { field: 'operation', value: 'ssh_write_file_content' },
      wandConfig: {
        enabled: true,
        prompt: `You are an expert at generating configuration files and file content for server deployment.
Generate file content based on the user's request for writing to a remote server via SSH.

Current content: {context}

RULES:
1. Generate ONLY the raw file content - no markdown, no explanations, no code blocks
2. Use proper formatting for the file type (JSON, YAML, INI, etc.)
3. Include helpful comments where appropriate for config files
4. Use sensible defaults and best practices
5. Ensure valid syntax for the file format

Examples:
- "nginx config" → server { listen 80; server_name example.com; ... }
- "json config" → { "key": "value", "port": 3000 }
- "env file" → NODE_ENV=production\\nPORT=3000\\nDATABASE_URL=...`,
      },
    },
    {
      id: 'writeMode',
      title: 'Write Mode',
      type: 'dropdown',
      options: [
        { label: 'Overwrite', id: 'overwrite' },
        { label: 'Append', id: 'append' },
        { label: 'Create (fail if exists)', id: 'create' },
      ],
      value: () => 'overwrite',
      condition: { field: 'operation', value: 'ssh_write_file_content' },
    },
    {
      id: 'writePermissions',
      title: 'Permissions',
      type: 'short-input',
      placeholder: '0644',
      condition: { field: 'operation', value: 'ssh_write_file_content' },
    },
  ],
  tools: {
    access: [
      'ssh_execute_command',
      'ssh_execute_script',
      'ssh_check_command_exists',
      'ssh_upload_file',
      'ssh_download_file',
      'ssh_list_directory',
      'ssh_check_file_exists',
      'ssh_create_directory',
      'ssh_delete_file',
      'ssh_move_rename',
      'ssh_get_system_info',
      'ssh_read_file_content',
      'ssh_write_file_content',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'ssh_execute_command'
      },
      params: (params) => {
        // Build connection config
        const connectionConfig: Record<string, unknown> = {
          host: params.host,
          port:
            typeof params.port === 'string' ? Number.parseInt(params.port, 10) : params.port || 22,
          username: params.username,
        }

        // Add authentication based on method
        if (params.authMethod === 'privateKey') {
          connectionConfig.privateKey = params.privateKey
          if (params.passphrase) {
            connectionConfig.passphrase = params.passphrase
          }
        } else {
          connectionConfig.password = params.password
        }

        // Build operation-specific parameters based on the selected operation
        const operation = params.operation || 'ssh_execute_command'

        switch (operation) {
          case 'ssh_execute_command':
            return {
              ...connectionConfig,
              command: params.command,
              workingDirectory: params.workingDirectory,
            }
          case 'ssh_execute_script':
            return {
              ...connectionConfig,
              script: params.script,
              interpreter: params.interpreter || '/bin/bash',
              workingDirectory: params.scriptWorkingDirectory,
            }
          case 'ssh_check_command_exists':
            return {
              ...connectionConfig,
              commandName: params.commandName,
            }
          case 'ssh_upload_file':
            return {
              ...connectionConfig,
              fileContent: params.fileContent,
              fileName: params.fileName,
              remotePath: params.remotePath,
              permissions: params.permissions,
            }
          case 'ssh_download_file':
            return {
              ...connectionConfig,
              remotePath: params.downloadRemotePath,
            }
          case 'ssh_list_directory':
            return {
              ...connectionConfig,
              path: params.listPath,
              detailed: params.detailed,
            }
          case 'ssh_check_file_exists':
            return {
              ...connectionConfig,
              path: params.checkPath,
              type: params.checkType || 'any',
            }
          case 'ssh_create_directory':
            return {
              ...connectionConfig,
              path: params.createPath,
              recursive: params.recursive !== false,
            }
          case 'ssh_delete_file':
            return {
              ...connectionConfig,
              path: params.deletePath,
              recursive: params.deleteRecursive,
              force: params.force,
            }
          case 'ssh_move_rename':
            return {
              ...connectionConfig,
              sourcePath: params.sourcePath,
              destinationPath: params.destinationPath,
              overwrite: params.overwrite,
            }
          case 'ssh_get_system_info':
            return connectionConfig
          case 'ssh_read_file_content':
            return {
              ...connectionConfig,
              path: params.readPath,
              encoding: params.encoding || 'utf-8',
              maxSize: params.maxSize ? Number.parseInt(params.maxSize, 10) : 10,
            }
          case 'ssh_write_file_content':
            return {
              ...connectionConfig,
              path: params.writePath,
              content: params.content,
              mode: params.writeMode || 'overwrite',
              permissions: params.writePermissions,
            }
          default:
            return connectionConfig
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'SSH operation to perform' },
    host: { type: 'string', description: 'SSH server hostname' },
    port: { type: 'number', description: 'SSH server port' },
    username: { type: 'string', description: 'SSH username' },
    authMethod: { type: 'string', description: 'Authentication method' },
    password: { type: 'string', description: 'Password for authentication' },
    privateKey: { type: 'string', description: 'Private key for authentication' },
    passphrase: { type: 'string', description: 'Passphrase for encrypted key' },
    command: { type: 'string', description: 'Command to execute' },
    script: { type: 'string', description: 'Script content to execute' },
    commandName: { type: 'string', description: 'Command name to check' },
    fileContent: { type: 'string', description: 'File content to upload' },
    fileName: { type: 'string', description: 'Name of the file' },
    remotePath: { type: 'string', description: 'Remote file/directory path' },
    content: { type: 'string', description: 'File content' },
  },
  outputs: {
    stdout: { type: 'string', description: 'Command standard output' },
    stderr: { type: 'string', description: 'Command standard error' },
    exitCode: { type: 'number', description: 'Command exit code' },
    success: { type: 'boolean', description: 'Operation success status' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileContent: { type: 'string', description: 'Downloaded/read file content' },
    entries: { type: 'json', description: 'Directory entries' },
    exists: { type: 'boolean', description: 'File/directory existence' },
    content: { type: 'string', description: 'File content' },
    hostname: { type: 'string', description: 'Server hostname' },
    os: { type: 'string', description: 'Operating system' },
    message: { type: 'string', description: 'Operation status message' },
  },
}

export const SSHBlockMeta = {
  tags: ['automation'],
  url: 'https://www.openssh.com',
  templates: [
    {
      icon: SshTerminalIcon,
      title: 'Scheduled server health check to Slack',
      prompt:
        'Every morning, SSH into the production server and run a health check command (uptime, load average, and free memory). Summarize stdout with an agent and post the result to the #ops Slack channel so the team starts the day knowing the box is healthy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Server,
      title: 'Disk-usage alert with SSH',
      prompt:
        "On a schedule, SSH into the server and execute 'df -h /' to read disk usage. Parse the stdout, and if the used percentage crosses 85%, send an alert to Slack with the current usage; otherwise stay silent.",
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'alerts'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Wrench,
      title: 'Run a deploy script over SSH',
      prompt:
        'Trigger a deployment by SSHing into the app server and executing a maintenance script that pulls the latest code, installs dependencies, rebuilds, and restarts the service. Check the exitCode and success outputs, then report stdout and stderr back so failures are visible.',
      modules: ['workflows', 'agent'],
      category: 'engineering',
      tags: ['devops', 'deployment', 'automation'],
    },
    {
      icon: ClipboardList,
      title: 'Tail and summarize a remote log',
      prompt:
        'SSH into the server and read the last 200 lines of /var/log/app.log, then hand the content to an agent that summarizes recent errors and warnings into a short digest. Post the digest so on-call engineers can scan incidents at a glance.',
      modules: ['workflows', 'agent'],
      category: 'engineering',
      tags: ['devops', 'logs', 'observability'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Download,
      title: 'Fetch a remote report file into the workflow',
      prompt:
        'Download a generated report file from the remote server via SSH and pass the resulting file output into the next step for processing or storage, so a nightly export on the box flows straight into the workflow.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['devops', 'files', 'automation'],
    },
    {
      icon: Search,
      title: 'Verify a command exists before running it',
      prompt:
        'Before executing a maintenance step, use Check Command Exists over SSH to confirm a tool like docker or git is installed on the remote host. If the exists output is true, run the command; if not, report a clear message that the dependency is missing.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'validation', 'automation'],
    },
    {
      icon: File,
      title: 'Push a config file and restart a service',
      prompt:
        'Upload a rendered configuration file to the remote server via SSH, write it to the target path, then execute a command to restart the affected service. Confirm success from the exitCode and stderr outputs before finishing.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'configuration', 'automation'],
    },
  ],
  skills: [
    {
      name: 'remote-health-check',
      description:
        'Run a lightweight health check over SSH and turn the output into a readable status line.',
      content:
        '# Remote Health Check\n\nRun a quick SSH health probe and summarize the result.\n\n## Steps\n1. Use the Execute Command operation with `uptime && free -m && df -h /`.\n2. Read `stdout` for load, memory, and disk figures.\n3. Confirm `exitCode` is 0 and `success` is true before trusting the output.\n4. Summarize into one status line (healthy / degraded) for posting downstream.\n\n## Output\nA short human-readable status derived from `stdout`, gated on `success`.',
    },
    {
      name: 'guarded-command-run',
      description:
        'Check a command exists over SSH before executing it, so missing dependencies fail loudly.',
      content:
        '# Guarded Command Run\n\nAvoid silent failures by verifying a dependency first.\n\n## Steps\n1. Use Check Command Exists with the target `commandName` (e.g. `docker`).\n2. Branch on the `exists` output.\n3. When `exists` is true, run the real command with Execute Command.\n4. When false, stop and report a clear "dependency missing" message.\n\n## Output\nEither the command `stdout`/`exitCode`, or an explicit missing-dependency message.',
    },
    {
      name: 'remote-log-digest',
      description:
        'Pull the tail of a remote log over SSH and summarize errors and warnings into a digest.',
      content:
        '# Remote Log Digest\n\nTurn a noisy remote log into a scannable summary.\n\n## Steps\n1. Use Read File Content on the log path (e.g. `/var/log/app.log`) with a sensible max size.\n2. Take the returned `content` and pass it to an agent.\n3. Ask the agent to extract recent errors, warnings, and their counts.\n4. Emit a short digest for Slack or a report.\n\n## Output\nA concise digest of notable log lines derived from the file `content`.',
    },
    {
      name: 'safe-config-deploy',
      description:
        'Upload a config file over SSH, then restart the service and verify the exit code.',
      content:
        '# Safe Config Deploy\n\nShip a config change and confirm the service came back healthy.\n\n## Steps\n1. Use Upload File (or Write File Content) to place the config at its target path.\n2. Execute the restart command for the affected service.\n3. Inspect `exitCode` and `stderr` to detect a failed restart.\n4. Report `success` plus any `stderr` so a bad deploy is visible immediately.\n\n## Output\nA pass/fail result built from `exitCode`, `success`, and `stderr`.',
    },
  ],
} as const satisfies BlockMeta
