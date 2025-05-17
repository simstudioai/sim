import { type TaskRun } from '@rightbrain/sdk'
import { ToolResponse } from '../types'

export interface RightBrainRunTaskParams {
  url: string
  inputs: object
  apiKey: string
}

export interface RightBrainRunTaskResponse extends ToolResponse {
  output: TaskRun<object, object>
}
