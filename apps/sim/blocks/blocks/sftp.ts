import {
  ClipboardList,
  Download,
  File,
  Search,
  Server,
  TrashOutline,
  Upload,
} from '@sim/emcn/icons'
import { SftpIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SftpUploadResult } from '@/tools/sftp/types'

export const SftpBlock: BlockConfig<SftpUploadResult> = {
  type: 'sftp',
  name: 'SFTP',
  description: 'Transfer files via SFTP (SSH File Transfer Protocol)',
  longDescription:
    'Upload, download, list, and manage files on remote servers via SFTP. Supports both password and private key authentication for secure file transfers.',
  docsLink: 'https://docs.sim.ai/integrations/sftp',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#2D3748',
  icon: SftpIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Upload Files', id: 'sftp_upload' },
        { label: 'Create File', id: 'sftp_create' },
        { label: 'Download File', id: 'sftp_download' },
        { label: 'List Directory', id: 'sftp_list' },
        { label: 'Delete File/Directory', id: 'sftp_delete' },
        { label: 'Create Directory', id: 'sftp_mkdir' },
      ],
      value: () => 'sftp_upload',
    },

    {
      id: 'host',
      title: 'SFTP Host',
      type: 'short-input',
      placeholder: 'sftp.example.com or 192.168.1.100',
      required: true,
    },
    {
      id: 'port',
      title: 'SFTP Port',
      type: 'short-input',
      placeholder: '22',
      value: () => '22',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'sftp-user',
      required: true,
    },

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

    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your SFTP password',
      condition: { field: 'authMethod', value: 'password' },
      dependsOn: ['authMethod'],
    },

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

    {
      id: 'remotePath',
      title: 'Remote Path',
      type: 'short-input',
      placeholder: '/home/user/uploads',
      required: true,
    },

    {
      id: 'uploadFiles',
      title: 'Files to Upload',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Select files to upload',
      mode: 'basic',
      multiple: true,
      required: false,
      condition: { field: 'operation', value: 'sftp_upload' },
    },
    {
      id: 'files',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference file from previous block (e.g., {{block_name.file}})',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'sftp_upload' },
    },

    {
      id: 'overwrite',
      title: 'Overwrite Existing Files',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: ['sftp_upload', 'sftp_create'] },
    },

    {
      id: 'permissions',
      title: 'File Permissions',
      type: 'short-input',
      placeholder: '0644',
      condition: { field: 'operation', value: ['sftp_upload', 'sftp_create'] },
      mode: 'advanced',
    },

    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'filename.txt',
      condition: { field: 'operation', value: 'sftp_create' },
      required: true,
    },
    {
      id: 'fileContent',
      title: 'File Content',
      type: 'code',
      placeholder: 'Text content to write to the file',
      condition: { field: 'operation', value: 'sftp_create' },
      required: true,
    },

    {
      id: 'encoding',
      title: 'Output Encoding',
      type: 'dropdown',
      options: [
        { label: 'UTF-8 (Text)', id: 'utf-8' },
        { label: 'Base64 (Binary)', id: 'base64' },
      ],
      value: () => 'utf-8',
      condition: { field: 'operation', value: 'sftp_download' },
    },

    {
      id: 'detailed',
      title: 'Show Detailed Info',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'sftp_list' },
    },

    {
      id: 'recursive',
      title: 'Recursive Delete',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'sftp_delete' },
    },

    {
      id: 'mkdirRecursive',
      title: 'Create Parent Directories',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'sftp_mkdir' },
    },
  ],

  tools: {
    access: ['sftp_upload', 'sftp_download', 'sftp_list', 'sftp_delete', 'sftp_mkdir'],
    config: {
      tool: (params) => {
        const operation = params.operation || 'sftp_upload'
        if (operation === 'sftp_create') return 'sftp_upload'
        return operation
      },
      params: (params) => {
        const connectionConfig: Record<string, unknown> = {
          host: params.host,
          port:
            typeof params.port === 'string' ? Number.parseInt(params.port, 10) : params.port || 22,
          username: params.username,
        }

        if (params.authMethod === 'privateKey') {
          connectionConfig.privateKey = params.privateKey
          if (params.passphrase) {
            connectionConfig.passphrase = params.passphrase
          }
        } else {
          connectionConfig.password = params.password
        }

        const operation = params.operation || 'sftp_upload'

        switch (operation) {
          case 'sftp_upload':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              // files is the canonical param from uploadFiles (basic) or files (advanced)
              files: normalizeFileInput(params.files),
              overwrite: params.overwrite !== false,
              permissions: params.permissions,
            }
          case 'sftp_create':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              fileContent: params.fileContent,
              fileName: params.fileName,
              overwrite: params.overwrite !== false,
              permissions: params.permissions,
            }
          case 'sftp_download':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              encoding: params.encoding || 'utf-8',
            }
          case 'sftp_list':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              detailed: params.detailed || false,
            }
          case 'sftp_delete':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              recursive: params.recursive || false,
            }
          case 'sftp_mkdir':
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
              recursive: params.mkdirRecursive !== false,
            }
          default:
            return {
              ...connectionConfig,
              remotePath: params.remotePath,
            }
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'SFTP operation to perform' },
    host: { type: 'string', description: 'SFTP server hostname' },
    port: { type: 'number', description: 'SFTP server port' },
    username: { type: 'string', description: 'SFTP username' },
    authMethod: { type: 'string', description: 'Authentication method (password or privateKey)' },
    password: { type: 'string', description: 'Password for authentication' },
    privateKey: { type: 'string', description: 'Private key for authentication' },
    passphrase: { type: 'string', description: 'Passphrase for encrypted key' },
    remotePath: { type: 'string', description: 'Remote path on the SFTP server' },
    files: { type: 'array', description: 'Files to upload (UserFile array)' },
    fileContent: { type: 'string', description: 'Direct content to upload' },
    fileName: { type: 'string', description: 'File name for direct content' },
    overwrite: { type: 'boolean', description: 'Overwrite existing files' },
    permissions: { type: 'string', description: 'File permissions (e.g., 0644)' },
    encoding: { type: 'string', description: 'Output encoding for download' },
    detailed: { type: 'boolean', description: 'Show detailed file info' },
    recursive: { type: 'boolean', description: 'Recursive delete' },
    mkdirRecursive: { type: 'boolean', description: 'Create parent directories' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    uploadedFiles: { type: 'json', description: 'Array of uploaded file details' },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    content: { type: 'string', description: 'Downloaded file content' },
    size: { type: 'number', description: 'File size in bytes' },
    entries: { type: 'json', description: 'Directory listing entries' },
    count: { type: 'number', description: 'Number of entries' },
    deletedPath: { type: 'string', description: 'Path that was deleted' },
    createdPath: { type: 'string', description: 'Directory that was created' },
    message: { type: 'string', description: 'Operation status message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}

export const SftpBlockMeta = {
  tags: ['document-processing', 'automation'],
  templates: [
    {
      icon: Download,
      title: 'Pull new files from a remote drop folder',
      prompt:
        'Build a workflow that runs on a schedule, lists a remote SFTP drop folder, downloads any new files, and passes their contents into the workflow for processing.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['files', 'automation', 'sftp'],
    },
    {
      icon: Upload,
      title: 'Push a generated report to a partner SFTP',
      prompt:
        'Build a workflow that generates a report file and uploads it to a partner SFTP server under a dated remote path.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['files', 'upload', 'sftp'],
    },
    {
      icon: Server,
      title: 'Mirror a local export to a remote directory',
      prompt:
        'Build a workflow that lists a remote SFTP directory, compares it to the files produced by an earlier block, and uploads any missing files to keep the remote directory in sync.',
      modules: ['files', 'scheduled', 'workflows'],
      category: 'operations',
      tags: ['files', 'sync', 'sftp'],
    },
    {
      icon: TrashOutline,
      title: 'Archive and delete old files on a schedule',
      prompt:
        'Build a workflow that runs nightly, lists an SFTP directory, downloads files older than a threshold to archive them, and then deletes the originals from the remote server.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['files', 'cleanup', 'sftp'],
    },
    {
      icon: ClipboardList,
      title: 'Notify Slack when new files land on SFTP',
      prompt:
        'Build a workflow that checks an SFTP inbox folder on a schedule and sends a Slack message listing any new files that have arrived since the last run.',
      modules: ['scheduled', 'files', 'agent'],
      category: 'operations',
      tags: ['files', 'notifications', 'sftp'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Search,
      title: 'Inventory a remote directory listing',
      prompt:
        'Build a workflow that lists a remote SFTP directory with detailed metadata and records the file names, sizes, and timestamps for auditing.',
      modules: ['files', 'workflows', 'tables'],
      category: 'operations',
      tags: ['files', 'audit', 'sftp'],
    },
    {
      icon: File,
      title: 'Write a manifest file to a remote server',
      prompt:
        'Build a workflow that assembles a manifest of processed records and creates a manifest.txt file on a remote SFTP path so downstream systems know the batch is ready.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['files', 'manifest', 'sftp'],
    },
    {
      icon: Download,
      title: 'Download a remote file and summarize it',
      prompt:
        'Build a workflow that downloads a file from an SFTP server and passes its contents to an agent that summarizes the key points.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['files', 'summarize', 'sftp'],
    },
  ],
  skills: [
    {
      name: 'pull-remote-drop-folder',
      description: 'Poll a remote SFTP drop folder on a schedule and ingest any new files.',
      content:
        '# Pull Remote Drop Folder\n\nPeriodically fetch newly arrived files from a remote SFTP directory into a workflow.\n\n## Steps\n1. Use the List Directory operation to read the remote drop folder and inspect `entries`.\n2. Filter for files newer than the last processed timestamp.\n3. For each new file, use the Download File operation and read `file`/`content`.\n4. Hand the contents to downstream blocks for parsing.\n\n## Output\nNew remote files are downloaded and their contents are available for processing each run.',
    },
    {
      name: 'push-report-to-partner',
      description: 'Upload a generated report to a partner SFTP server under a dated path.',
      content:
        '# Push Report To Partner\n\nDeliver a generated file to an external partner over SFTP.\n\n## Steps\n1. Produce the report file in an earlier block.\n2. Use the Upload Files operation with the partner `remotePath` (e.g. `/outbound/2026-07-01/`).\n3. Enable overwrite only if same-day re-delivery is expected.\n4. Confirm delivery from `uploadedFiles`.\n\n## Output\nThe report lands on the partner SFTP server at the intended remote path.',
    },
    {
      name: 'archive-and-cleanup',
      description: 'Download aging remote files to archive them, then delete the originals.',
      content:
        '# Archive And Cleanup\n\nKeep a remote SFTP directory tidy by archiving and removing old files.\n\n## Steps\n1. List the target directory and identify files past the retention window.\n2. Download each stale file to archive it elsewhere.\n3. Use the Delete File/Directory operation to remove the original and check `deletedPath`.\n4. Schedule the workflow to run nightly.\n\n## Output\nAging files are preserved in an archive and cleared from the live remote directory.',
    },
    {
      name: 'remote-directory-inventory',
      description: 'Capture a detailed listing of a remote SFTP directory for auditing.',
      content:
        '# Remote Directory Inventory\n\nRecord what currently exists in a remote SFTP path.\n\n## Steps\n1. Use the List Directory operation with detailed info enabled.\n2. Read `entries` for names, sizes, and timestamps.\n3. Store the inventory in a table or log for auditing.\n\n## Output\nA point-in-time inventory of the remote directory is captured.',
    },
  ],
} as const satisfies BlockMeta
