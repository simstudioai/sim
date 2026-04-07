import type { ToolResponse } from '@/tools/types'

export interface ObsidianBaseParams {
  apiKey: string
  baseUrl: string
}

export interface ObsidianListFilesParams extends ObsidianBaseParams {
  path?: string
}

export interface ObsidianListFilesResponse extends ToolResponse {
  output: {
    files: Array<{
      path: string
      type: string
    }>
  }
}

export interface ObsidianGetNoteParams extends ObsidianBaseParams {
  filename: string
}

export interface ObsidianGetNoteResponse extends ToolResponse {
  output: {
    content: string
    filename: string
  }
}

export interface ObsidianCreateNoteParams extends ObsidianBaseParams {
  filename: string
  content: string
}

export interface ObsidianCreateNoteResponse extends ToolResponse {
  output: {
    filename: string
    created: boolean
  }
}

export interface ObsidianAppendNoteParams extends ObsidianBaseParams {
  filename: string
  content: string
}

export interface ObsidianAppendNoteResponse extends ToolResponse {
  output: {
    filename: string
    appended: boolean
  }
}

export interface ObsidianPatchNoteParams extends ObsidianBaseParams {
  filename: string
  content: string
  operation: string
  targetType: string
  target: string
  targetDelimiter?: string
  trimTargetWhitespace?: boolean
}

export interface ObsidianPatchNoteResponse extends ToolResponse {
  output: {
    filename: string
    patched: boolean
  }
}

export interface ObsidianDeleteNoteParams extends ObsidianBaseParams {
  filename: string
}

export interface ObsidianDeleteNoteResponse extends ToolResponse {
  output: {
    filename: string
    deleted: boolean
  }
}

export interface ObsidianSearchParams extends ObsidianBaseParams {
  query: string
  contextLength?: number
}

export interface ObsidianSearchResponse extends ToolResponse {
  output: {
    results: Array<{
      filename: string
      score: number
      matches: Array<{
        context: string
      }>
    }>
  }
}

export interface ObsidianGetActiveParams extends ObsidianBaseParams {}

export interface ObsidianGetActiveResponse extends ToolResponse {
  output: {
    content: string
    filename: string | null
  }
}

export interface ObsidianAppendActiveParams extends ObsidianBaseParams {
  content: string
}

export interface ObsidianAppendActiveResponse extends ToolResponse {
  output: {
    appended: boolean
  }
}

export interface ObsidianPatchActiveParams extends ObsidianBaseParams {
  content: string
  operation: string
  targetType: string
  target: string
  targetDelimiter?: string
  trimTargetWhitespace?: boolean
}

export interface ObsidianPatchActiveResponse extends ToolResponse {
  output: {
    patched: boolean
  }
}

export interface ObsidianListCommandsParams extends ObsidianBaseParams {}

export interface ObsidianListCommandsResponse extends ToolResponse {
  output: {
    commands: Array<{
      id: string
      name: string
    }>
  }
}

export interface ObsidianExecuteCommandParams extends ObsidianBaseParams {
  commandId: string
}

export interface ObsidianExecuteCommandResponse extends ToolResponse {
  output: {
    commandId: string
    executed: boolean
  }
}

export interface ObsidianOpenFileParams extends ObsidianBaseParams {
  filename: string
  newLeaf?: boolean
}

export interface ObsidianOpenFileResponse extends ToolResponse {
  output: {
    filename: string
    opened: boolean
  }
}

export interface ObsidianGetPeriodicNoteParams extends ObsidianBaseParams {
  period: string
}

export interface ObsidianGetPeriodicNoteResponse extends ToolResponse {
  output: {
    content: string
    period: string
  }
}

export interface ObsidianAppendPeriodicNoteParams extends ObsidianBaseParams {
  period: string
  content: string
}

export interface ObsidianAppendPeriodicNoteResponse extends ToolResponse {
  output: {
    period: string
    appended: boolean
  }
}
