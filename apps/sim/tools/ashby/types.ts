import type { ToolResponse } from '@/tools/types'

export interface AshbyBaseParams {
  apiKey: string
}

export interface AshbyContactInfo {
  value: string
  type: string
  isPrimary: boolean
}

export interface AshbyListCandidatesParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
}

export interface AshbyGetCandidateParams extends AshbyBaseParams {
  candidateId: string
}

export interface AshbyCreateCandidateParams extends AshbyBaseParams {
  name: string
  email?: string
  emailType?: string
  phoneNumber?: string
  phoneType?: string
  linkedInUrl?: string
  githubUrl?: string
  sourceId?: string
}

export interface AshbySearchCandidatesParams extends AshbyBaseParams {
  name?: string
  email?: string
}

export interface AshbyListJobsParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
  status?: string
}

export interface AshbyGetJobParams extends AshbyBaseParams {
  jobId: string
}

export interface AshbyCreateNoteParams extends AshbyBaseParams {
  candidateId: string
  note: string
  noteType?: string
  sendNotifications?: boolean
}

export interface AshbyListApplicationsParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
  status?: string
  jobId?: string
  candidateId?: string
  createdAfter?: string
}

export interface AshbyListCandidatesResponse extends ToolResponse {
  output: {
    candidates: Array<{
      id: string
      name: string
      primaryEmailAddress: AshbyContactInfo | null
      primaryPhoneNumber: AshbyContactInfo | null
      createdAt: string
      updatedAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export interface AshbyGetCandidateResponse extends ToolResponse {
  output: {
    id: string
    name: string
    primaryEmailAddress: AshbyContactInfo | null
    primaryPhoneNumber: AshbyContactInfo | null
    profileUrl: string | null
    position: string | null
    company: string | null
    linkedInUrl: string | null
    githubUrl: string | null
    tags: Array<{ id: string; title: string }>
    applicationIds: string[]
    createdAt: string
    updatedAt: string
  }
}

export interface AshbyCreateCandidateResponse extends ToolResponse {
  output: {
    id: string
    name: string
    primaryEmailAddress: AshbyContactInfo | null
    primaryPhoneNumber: AshbyContactInfo | null
    createdAt: string
  }
}

export interface AshbySearchCandidatesResponse extends ToolResponse {
  output: {
    candidates: Array<{
      id: string
      name: string
      primaryEmailAddress: AshbyContactInfo | null
      primaryPhoneNumber: AshbyContactInfo | null
    }>
  }
}

export interface AshbyListJobsResponse extends ToolResponse {
  output: {
    jobs: Array<{
      id: string
      title: string
      status: string
      employmentType: string | null
      departmentId: string | null
      locationId: string | null
      createdAt: string
      updatedAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export interface AshbyGetJobResponse extends ToolResponse {
  output: {
    id: string
    title: string
    status: string
    employmentType: string | null
    departmentId: string | null
    locationId: string | null
    descriptionPlain: string | null
    isArchived: boolean
    createdAt: string
    updatedAt: string
  }
}

export interface AshbyCreateNoteResponse extends ToolResponse {
  output: {
    id: string
    content: string
    author: {
      id: string
      firstName: string
      lastName: string
      email: string
    } | null
    createdAt: string
  }
}

export interface AshbyListApplicationsResponse extends ToolResponse {
  output: {
    applications: Array<{
      id: string
      status: string
      candidate: {
        id: string
        name: string
      }
      job: {
        id: string
        title: string
      }
      currentInterviewStage: {
        id: string
        title: string
        type: string
      } | null
      source: {
        id: string
        title: string
      } | null
      createdAt: string
      updatedAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}
