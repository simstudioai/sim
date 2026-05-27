import type { ToolResponse } from '@/tools/types'

/** Base parameters shared by all Ironclad tools */
export interface IroncladBaseParams {
  accessToken: string
}

/** Create Workflow params */
export interface IroncladCreateWorkflowParams extends IroncladBaseParams {
  template: string
  attributes?: string
}

/** Create Workflow response */
export interface IroncladCreateWorkflowResponse extends ToolResponse {
  output: {
    id: string
    status: string | null
    template: string | null
    creator: string | null
  }
}

/** List Workflows params */
export interface IroncladListWorkflowsParams extends IroncladBaseParams {
  page?: number
  perPage?: number
}

/** List Workflows response */
export interface IroncladListWorkflowsResponse extends ToolResponse {
  output: {
    workflows: IroncladWorkflowSummary[]
    page: number
    pageSize: number
    count: number
  }
}

/** Get Workflow params */
export interface IroncladGetWorkflowParams extends IroncladBaseParams {
  ironcladWorkflowId: string
}

/** Get Workflow response */
export interface IroncladGetWorkflowResponse extends ToolResponse {
  output: {
    id: string
    status: string | null
    template: string | null
    creator: string | null
    step: string | null
    attributes: Record<string, unknown> | null
  }
}

/** Update Workflow Metadata params */
export interface IroncladUpdateWorkflowMetadataParams extends IroncladBaseParams {
  ironcladWorkflowId: string
  actions: string
}

/** Update Workflow Metadata response */
export interface IroncladUpdateWorkflowMetadataResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** Create Record params */
export interface IroncladCreateRecordParams extends IroncladBaseParams {
  recordType: string
  name: string
  properties?: string
  links?: string
}

/** Create Record response */
export interface IroncladCreateRecordResponse extends ToolResponse {
  output: {
    id: string
    name: string
    type: string | null
  }
}

/** List Records params */
export interface IroncladListRecordsParams extends IroncladBaseParams {
  page?: number
  pageSize?: number
  lastUpdated?: string
}

/** List Records response */
export interface IroncladListRecordsResponse extends ToolResponse {
  output: {
    records: IroncladRecordSummary[]
    page: number
    pageSize: number
    count: number
  }
}

/** Get Record params */
export interface IroncladGetRecordParams extends IroncladBaseParams {
  recordId: string
}

/** Get Record response */
export interface IroncladGetRecordResponse extends ToolResponse {
  output: {
    id: string
    name: string | null
    type: string | null
    properties: Record<string, unknown> | null
    createdAt: string | null
    updatedAt: string | null
  }
}

/** Update Record params */
export interface IroncladUpdateRecordParams extends IroncladBaseParams {
  recordId: string
  properties: string
}

/** Update Record response */
export interface IroncladUpdateRecordResponse extends ToolResponse {
  output: {
    id: string
    name: string | null
    type: string | null
  }
}

/** Cancel Workflow params */
export interface IroncladCancelWorkflowParams extends IroncladBaseParams {
  ironcladWorkflowId: string
}

/** Cancel Workflow response */
export interface IroncladCancelWorkflowResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** List Workflow Approvals params */
export interface IroncladListWorkflowApprovalsParams extends IroncladBaseParams {
  ironcladWorkflowId: string
}

/** List Workflow Approvals response */
export interface IroncladListWorkflowApprovalsResponse extends ToolResponse {
  output: {
    approvals: unknown[]
  }
}

/** Add Comment params */
export interface IroncladAddCommentParams extends IroncladBaseParams {
  ironcladWorkflowId: string
  comment: string
}

/** Add Comment response */
export interface IroncladAddCommentResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** List Workflow Comments params */
export interface IroncladListWorkflowCommentsParams extends IroncladBaseParams {
  ironcladWorkflowId: string
}

/** List Workflow Comments response */
export interface IroncladListWorkflowCommentsResponse extends ToolResponse {
  output: {
    comments: unknown[]
  }
}

/** Shared summary types */
export interface IroncladWorkflowSummary {
  id: string
  status: string | null
  template: string | null
  creator: string | null
}

export interface IroncladRecordSummary {
  id: string
  name: string | null
  type: string | null
  createdAt: string | null
  updatedAt: string | null
}
