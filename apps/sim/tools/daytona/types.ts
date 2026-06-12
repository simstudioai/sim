import type { TableRow, ToolResponse } from '@/tools/types'

export interface DaytonaSandboxSummary {
  id: string
  name: string
  state: string | null
  snapshot: string | null
  target: string | null
  cpu: number | null
  gpu: number | null
  memory: number | null
  disk: number | null
  labels: Record<string, string>
  public: boolean | null
  errorReason: string | null
  autoStopInterval: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DaytonaFileInfo {
  name: string
  isDir: boolean
  size: number
  mode: string
  permissions: string
  owner: string
  group: string
  modifiedAt: string
}

interface DaytonaBaseParams {
  apiKey: string
}

interface DaytonaSandboxScopedParams extends DaytonaBaseParams {
  sandboxId: string
}

export interface DaytonaCreateSandboxParams extends DaytonaBaseParams {
  snapshot?: string
  name?: string
  target?: string
  user?: string
  env?: TableRow[] | Record<string, string> | string
  labels?: TableRow[] | Record<string, string> | string
  cpu?: number
  memory?: number
  disk?: number
  autoStopInterval?: number
  autoArchiveInterval?: number
  autoDeleteInterval?: number
  public?: boolean
}

export interface DaytonaListSandboxesParams extends DaytonaBaseParams {
  limit?: number
  name?: string
  labels?: TableRow[] | Record<string, string> | string
  cursor?: string
}

export type DaytonaGetSandboxParams = DaytonaSandboxScopedParams

export type DaytonaStartSandboxParams = DaytonaSandboxScopedParams

export type DaytonaStopSandboxParams = DaytonaSandboxScopedParams

export type DaytonaDeleteSandboxParams = DaytonaSandboxScopedParams

export interface DaytonaExecuteCommandParams extends DaytonaSandboxScopedParams {
  command: string
  cwd?: string
  env?: TableRow[] | Record<string, string> | string
  timeout?: number
}

export interface DaytonaRunCodeParams extends DaytonaSandboxScopedParams {
  code: string
  language: 'python' | 'javascript' | 'typescript'
  env?: TableRow[] | Record<string, string> | string
  timeout?: number
}

export interface DaytonaUploadFileParams extends DaytonaSandboxScopedParams {
  destinationPath: string
  file?: unknown
  fileContent?: string
  fileName?: string
}

export interface DaytonaDownloadFileParams extends DaytonaSandboxScopedParams {
  filePath: string
}

export interface DaytonaListFilesParams extends DaytonaSandboxScopedParams {
  path?: string
}

export interface DaytonaGitCloneParams extends DaytonaSandboxScopedParams {
  url: string
  path: string
  branch?: string
  commitId?: string
  username?: string
  password?: string
}

export interface DaytonaSandboxResponse extends ToolResponse {
  output: {
    sandbox: DaytonaSandboxSummary
  }
}

export interface DaytonaListSandboxesResponse extends ToolResponse {
  output: {
    sandboxes: DaytonaSandboxSummary[]
    nextCursor: string | null
  }
}

export interface DaytonaExecuteCommandResponse extends ToolResponse {
  output: {
    exitCode: number
    result: string
  }
}

export interface DaytonaRunCodeResponse extends ToolResponse {
  output: {
    exitCode: number
    result: string
    artifacts: Record<string, unknown> | null
  }
}

export interface DaytonaUploadFileResponse extends ToolResponse {
  output: {
    uploadedPath: string
    name: string
    size: number
  }
}

export interface DaytonaDownloadFileResponse extends ToolResponse {
  output: {
    file: unknown
    name: string
    mimeType: string
    size: number
  }
}

export interface DaytonaListFilesResponse extends ToolResponse {
  output: {
    files: DaytonaFileInfo[]
  }
}

export interface DaytonaGitCloneResponse extends ToolResponse {
  output: {
    repoUrl: string
    clonePath: string
  }
}
