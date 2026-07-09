import { JupyterIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

const PATH_OPERATIONS = [
  'jupyter_list_contents',
  'jupyter_get_content',
  'jupyter_create_file',
  'jupyter_upload_file',
  'jupyter_rename_content',
  'jupyter_delete_content',
  'jupyter_copy_content',
  'jupyter_create_session',
] as const

const REQUIRED_PATH_OPERATIONS = [
  'jupyter_get_content',
  'jupyter_create_file',
  'jupyter_upload_file',
  'jupyter_rename_content',
  'jupyter_delete_content',
  'jupyter_copy_content',
  'jupyter_create_session',
] as const

const KERNEL_ID_OPERATIONS = [
  'jupyter_stop_kernel',
  'jupyter_restart_kernel',
  'jupyter_interrupt_kernel',
] as const

export const JupyterBlock: BlockConfig = {
  type: 'jupyter',
  name: 'Jupyter',
  description: 'Manage files, notebooks, kernels, and sessions on a Jupyter server',
  longDescription:
    'Integrate a self-hosted Jupyter server into the workflow. Browse, read, create, upload, rename, copy, and delete files and notebooks; start, stop, restart, and interrupt kernels; and manage sessions that bind notebooks to kernels.',
  docsLink: 'https://docs.sim.ai/integrations/jupyter',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: JupyterIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Contents', id: 'jupyter_list_contents' },
        { label: 'Get Content', id: 'jupyter_get_content' },
        { label: 'Create File', id: 'jupyter_create_file' },
        { label: 'Upload File', id: 'jupyter_upload_file' },
        { label: 'Rename Content', id: 'jupyter_rename_content' },
        { label: 'Delete Content', id: 'jupyter_delete_content' },
        { label: 'Copy Content', id: 'jupyter_copy_content' },
        { label: 'List Kernels', id: 'jupyter_list_kernels' },
        { label: 'Start Kernel', id: 'jupyter_start_kernel' },
        { label: 'Stop Kernel', id: 'jupyter_stop_kernel' },
        { label: 'Restart Kernel', id: 'jupyter_restart_kernel' },
        { label: 'Interrupt Kernel', id: 'jupyter_interrupt_kernel' },
        { label: 'List Kernel Specs', id: 'jupyter_list_kernelspecs' },
        { label: 'List Sessions', id: 'jupyter_list_sessions' },
        { label: 'Create Session', id: 'jupyter_create_session' },
        { label: 'Delete Session', id: 'jupyter_delete_session' },
      ],
      value: () => 'jupyter_list_contents',
    },
    {
      id: 'serverUrl',
      title: 'Server URL',
      type: 'short-input',
      placeholder: 'http://localhost:8888',
      required: true,
    },
    {
      id: 'token',
      title: 'Token',
      type: 'short-input',
      placeholder: 'Enter your Jupyter server token',
      password: true,
      required: true,
    },

    // Path (shared across contents operations)
    {
      id: 'path',
      title: 'Path',
      type: 'short-input',
      placeholder: 'notebooks/analysis.ipynb',
      condition: { field: 'operation', value: [...PATH_OPERATIONS] },
      required: { field: 'operation', value: [...REQUIRED_PATH_OPERATIONS] },
    },

    // Create File
    {
      id: 'type',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'File', id: 'file' },
        { label: 'Notebook', id: 'notebook' },
        { label: 'Directory', id: 'directory' },
      ],
      value: () => 'file',
      condition: { field: 'operation', value: 'jupyter_create_file' },
      required: { field: 'operation', value: 'jupyter_create_file' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'File text, or a JSON-stringified notebook document',
      mode: 'advanced',
      condition: { field: 'operation', value: 'jupyter_create_file' },
    },

    // Upload File
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file to send to Jupyter',
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'jupyter_upload_file' },
      condition: { field: 'operation', value: 'jupyter_upload_file' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      required: { field: 'operation', value: 'jupyter_upload_file' },
      condition: { field: 'operation', value: 'jupyter_upload_file' },
    },
    {
      id: 'uploadFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional filename override',
      mode: 'advanced',
      condition: { field: 'operation', value: 'jupyter_upload_file' },
    },

    // Rename Content
    {
      id: 'newPath',
      title: 'New Path',
      type: 'short-input',
      placeholder: 'notebooks/renamed.ipynb',
      condition: { field: 'operation', value: 'jupyter_rename_content' },
      required: { field: 'operation', value: 'jupyter_rename_content' },
    },

    // Copy Content
    {
      id: 'copyFromPath',
      title: 'Copy From Path',
      type: 'short-input',
      placeholder: 'notebooks/source.ipynb',
      condition: { field: 'operation', value: 'jupyter_copy_content' },
      required: { field: 'operation', value: 'jupyter_copy_content' },
    },

    // Kernels
    {
      id: 'kernelName',
      title: 'Kernel Name',
      type: 'short-input',
      placeholder: 'python3',
      condition: { field: 'operation', value: ['jupyter_start_kernel', 'jupyter_create_session'] },
    },
    {
      id: 'kernelId',
      title: 'Kernel ID',
      type: 'short-input',
      placeholder: 'Enter kernel ID',
      condition: { field: 'operation', value: [...KERNEL_ID_OPERATIONS] },
      required: { field: 'operation', value: [...KERNEL_ID_OPERATIONS] },
    },

    // Sessions
    {
      id: 'sessionName',
      title: 'Session Name',
      type: 'short-input',
      placeholder: 'Optional session name',
      mode: 'advanced',
      condition: { field: 'operation', value: 'jupyter_create_session' },
    },
    {
      id: 'sessionType',
      title: 'Session Type',
      type: 'short-input',
      placeholder: 'notebook',
      mode: 'advanced',
      condition: { field: 'operation', value: 'jupyter_create_session' },
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Enter session ID',
      condition: { field: 'operation', value: 'jupyter_delete_session' },
      required: { field: 'operation', value: 'jupyter_delete_session' },
    },
  ],

  tools: {
    access: [
      'jupyter_list_contents',
      'jupyter_get_content',
      'jupyter_create_file',
      'jupyter_upload_file',
      'jupyter_rename_content',
      'jupyter_delete_content',
      'jupyter_copy_content',
      'jupyter_list_kernels',
      'jupyter_start_kernel',
      'jupyter_stop_kernel',
      'jupyter_restart_kernel',
      'jupyter_interrupt_kernel',
      'jupyter_list_kernelspecs',
      'jupyter_list_sessions',
      'jupyter_create_session',
      'jupyter_delete_session',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (normalizedFile) {
          params.file = normalizedFile
        }

        const { operation, ...rest } = params

        const baseParams: Record<string, unknown> = {
          serverUrl: rest.serverUrl,
          token: rest.token,
        }

        switch (operation) {
          case 'jupyter_list_contents':
            if (rest.path) baseParams.path = rest.path
            break
          case 'jupyter_get_content':
          case 'jupyter_delete_content':
            baseParams.path = rest.path
            break
          case 'jupyter_create_file':
            baseParams.path = rest.path
            baseParams.type = rest.type
            if (rest.content) baseParams.content = rest.content
            break
          case 'jupyter_upload_file':
            baseParams.path = rest.path
            baseParams.file = rest.file
            if (rest.uploadFileName) baseParams.fileName = rest.uploadFileName
            break
          case 'jupyter_rename_content':
            baseParams.path = rest.path
            baseParams.newPath = rest.newPath
            break
          case 'jupyter_copy_content':
            baseParams.path = rest.path
            baseParams.copyFromPath = rest.copyFromPath
            break
          case 'jupyter_start_kernel':
            if (rest.kernelName) baseParams.kernelName = rest.kernelName
            break
          case 'jupyter_stop_kernel':
          case 'jupyter_restart_kernel':
          case 'jupyter_interrupt_kernel':
            baseParams.kernelId = rest.kernelId
            break
          case 'jupyter_create_session':
            baseParams.path = rest.path
            if (rest.kernelName) baseParams.kernelName = rest.kernelName
            if (rest.sessionName) baseParams.name = rest.sessionName
            if (rest.sessionType) baseParams.type = rest.sessionType
            break
          case 'jupyter_delete_session':
            baseParams.sessionId = rest.sessionId
            break
        }

        return baseParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    serverUrl: { type: 'string', description: 'Jupyter server base URL' },
    token: { type: 'string', description: 'Jupyter server authentication token' },
    path: { type: 'string', description: 'Path relative to the server root' },
    type: { type: 'string', description: 'file, notebook, or directory' },
    content: { type: 'string', description: 'File or notebook content' },
    file: { type: 'json', description: 'File to upload (canonical param)' },
    uploadFileName: { type: 'string', description: 'Optional filename override' },
    newPath: { type: 'string', description: 'New path for rename/move' },
    copyFromPath: { type: 'string', description: 'Source path to copy from' },
    kernelName: { type: 'string', description: 'Kernel spec name' },
    kernelId: { type: 'string', description: 'Kernel ID' },
    sessionName: { type: 'string', description: 'Session name' },
    sessionType: { type: 'string', description: 'Session type' },
    sessionId: { type: 'string', description: 'Session ID' },
  },

  outputs: {
    items: 'json',
    path: 'string',
    name: 'string',
    type: 'string',
    mimetype: 'string',
    text: 'string',
    file: 'file',
    size: 'number',
    createdAt: 'string',
    lastModified: 'string',
    success: 'boolean',
    id: 'string',
    lastActivity: 'string',
    executionState: 'string',
    connections: 'number',
    kernels: 'json',
    defaultKernelName: 'string',
    kernelspecs: 'json',
    sessions: 'json',
    kernel: 'json',
    kernelId: 'string',
    sessionId: 'string',
  },
}

export const JupyterBlockMeta = {
  tags: ['automation', 'data-analytics'],
  templates: [
    {
      icon: JupyterIcon,
      title: 'Jupyter notebook creator',
      prompt:
        'Build a workflow that generates a Jupyter notebook from a data analysis request and creates it on a self-hosted Jupyter server.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: JupyterIcon,
      title: 'Upload datasets to Jupyter',
      prompt:
        'Build a workflow that uploads a file from a Table row to a Jupyter server as a dataset for later analysis.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: JupyterIcon,
      title: 'Jupyter kernel health check',
      prompt:
        'Build a scheduled workflow that lists running Jupyter kernels, restarts any kernel stuck in a busy state, and posts a summary to Slack.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JupyterIcon,
      title: 'Notebook directory sync report',
      prompt:
        'Build a workflow that lists the contents of a Jupyter server directory and writes a summary of files and notebooks to a Table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: JupyterIcon,
      title: 'Read notebook and summarize',
      prompt:
        'Build a workflow that reads a Jupyter notebook, has an agent summarize its cells, and sends the summary in Chat.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: JupyterIcon,
      title: 'Provision a Jupyter session',
      prompt:
        'Build a workflow that creates a Jupyter session bound to a new notebook and a fresh Python kernel whenever a new project request comes in.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: JupyterIcon,
      title: 'Archive and clean up notebooks',
      prompt:
        'Build a scheduled workflow that copies old notebooks on a Jupyter server into an archive directory, then deletes the originals.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
} as const satisfies BlockMeta
