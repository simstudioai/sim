import type { ToolResponse } from '@/tools/types'

export interface JupyterAuthParams {
  serverUrl: string
  token: string
}

export interface JupyterContentItem {
  name: string
  path: string
  type: 'directory' | 'file' | 'notebook'
  writable: boolean
  created: string | null
  lastModified: string | null
  size: number | null
  mimetype: string | null
  format: 'json' | 'text' | 'base64' | null
}

export interface JupyterKernel {
  id: string
  name: string
  lastActivity: string | null
  executionState: string | null
  connections: number | null
}

export interface JupyterKernelSpec {
  name: string
  displayName: string
  language: string | null
  argv: string[]
  interruptMode: string | null
}

export interface JupyterSession {
  id: string
  path: string
  name: string
  type: string
  kernel: JupyterKernel | null
}

export interface JupyterListContentsParams extends JupyterAuthParams {
  path?: string
}

export interface JupyterListContentsResponse extends ToolResponse {
  output: {
    items: JupyterContentItem[]
    path: string
  }
}

export interface JupyterGetContentParams extends JupyterAuthParams {
  path: string
}

export interface JupyterGetContentResponse extends ToolResponse {
  output: {
    name: string
    path: string
    mimetype: string | null
    text: string | null
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    } | null
  }
}

export interface JupyterCreateFileParams extends JupyterAuthParams {
  path: string
  type: 'file' | 'notebook' | 'directory'
  content?: string
}

export interface JupyterCreateFileResponse extends ToolResponse {
  output: {
    name: string
    path: string
    type: 'directory' | 'file' | 'notebook'
    createdAt: string | null
    lastModified: string | null
  }
}

export interface JupyterUploadFileParams extends JupyterAuthParams {
  directory?: string
  file?: unknown
  fileContent?: string
  fileName?: string
}

export interface JupyterUploadFileResponse extends ToolResponse {
  output: {
    name: string
    path: string
    size: number | null
    lastModified: string | null
  }
}

export interface JupyterRenameContentParams extends JupyterAuthParams {
  path: string
  newPath: string
}

export interface JupyterRenameContentResponse extends ToolResponse {
  output: {
    name: string
    path: string
    lastModified: string | null
  }
}

export interface JupyterDeleteContentParams extends JupyterAuthParams {
  path: string
}

export interface JupyterDeleteContentResponse extends ToolResponse {
  output: {
    success: boolean
    path: string
  }
}

export interface JupyterCopyContentParams extends JupyterAuthParams {
  path: string
  copyFromPath: string
}

export interface JupyterCopyContentResponse extends ToolResponse {
  output: {
    name: string
    path: string
    createdAt: string | null
  }
}

export interface JupyterListKernelsParams extends JupyterAuthParams {}

export interface JupyterListKernelsResponse extends ToolResponse {
  output: {
    kernels: JupyterKernel[]
  }
}

export interface JupyterStartKernelParams extends JupyterAuthParams {
  kernelName?: string
}

export interface JupyterStartKernelResponse extends ToolResponse {
  output: JupyterKernel
}

export interface JupyterStopKernelParams extends JupyterAuthParams {
  kernelId: string
}

export interface JupyterStopKernelResponse extends ToolResponse {
  output: {
    success: boolean
    kernelId: string
  }
}

export interface JupyterRestartKernelParams extends JupyterAuthParams {
  kernelId: string
}

export interface JupyterRestartKernelResponse extends ToolResponse {
  output: JupyterKernel
}

export interface JupyterInterruptKernelParams extends JupyterAuthParams {
  kernelId: string
}

export interface JupyterInterruptKernelResponse extends ToolResponse {
  output: {
    success: boolean
    kernelId: string
  }
}

export interface JupyterListKernelspecsParams extends JupyterAuthParams {}

export interface JupyterListKernelspecsResponse extends ToolResponse {
  output: {
    defaultKernelName: string | null
    kernelspecs: JupyterKernelSpec[]
  }
}

export interface JupyterListSessionsParams extends JupyterAuthParams {}

export interface JupyterListSessionsResponse extends ToolResponse {
  output: {
    sessions: JupyterSession[]
  }
}

export interface JupyterCreateSessionParams extends JupyterAuthParams {
  path: string
  kernelName?: string
  name?: string
  type?: string
}

export interface JupyterCreateSessionResponse extends ToolResponse {
  output: JupyterSession
}

export interface JupyterDeleteSessionParams extends JupyterAuthParams {
  sessionId: string
}

export interface JupyterDeleteSessionResponse extends ToolResponse {
  output: {
    success: boolean
    sessionId: string
  }
}
