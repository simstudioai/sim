import type { ToolResponse } from '@/tools/types'

export interface LemlistBaseParams {
  apiKey: string
}

export interface LemlistGetActivitiesParams extends LemlistBaseParams {
  type?: string
  campaignId?: string
  leadId?: string
  isFirst?: boolean
  limit?: number
  offset?: number
}

export interface LemlistActivity {
  _id: string
  type: string
  leadId: string
  campaignId: string
  sequenceId: string | null
  stepId: string | null
  createdAt: string
}

export interface LemlistGetActivitiesResponse extends ToolResponse {
  output: {
    activities: LemlistActivity[]
    count: number
  }
}

export interface LemlistGetLeadParams extends LemlistBaseParams {
  leadIdentifier: string
}

export interface LemlistLead {
  _id: string
  email: string
  firstName: string | null
  lastName: string | null
  companyName: string | null
  jobTitle: string | null
  companyDomain: string | null
  isPaused: boolean
  campaignId: string | null
  contactId: string | null
  emailStatus: string | null
}

export interface LemlistGetLeadResponse extends ToolResponse {
  output: LemlistLead
}

export interface LemlistSendEmailParams extends LemlistBaseParams {
  sendUserId: string
  sendUserEmail: string
  sendUserMailboxId: string
  contactId: string
  leadId: string
  subject: string
  message: string
  cc?: string[]
}

export interface LemlistSendEmailResponse extends ToolResponse {
  output: {
    ok: boolean
  }
}

export type LemlistResponse =
  | LemlistGetActivitiesResponse
  | LemlistGetLeadResponse
  | LemlistSendEmailResponse
