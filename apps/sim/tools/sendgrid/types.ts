import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

// Shared type definitions
export interface SendGridContact {
  id: string
  email: string
  first_name?: string
  last_name?: string
  created_at?: string
  updated_at?: string
  list_ids?: string[]
  custom_fields?: Record<string, unknown>
}

export interface SendGridList {
  id: string
  name: string
  contact_count: number
  _metadata?: {
    self?: string
  }
}

export interface SendGridTemplateVersion {
  id: string
  template_id: string
  name: string
  subject: string
  active: number | boolean
  html_content?: string
  plain_content?: string
  updated_at?: string
}

export interface SendGridTemplate {
  id: string
  name: string
  generation: 'legacy' | 'dynamic'
  created_at?: string
  updated_at?: string
  versions?: SendGridTemplateVersion[]
}

export interface SendGridPersonalization {
  to: Array<{ email: string; name?: string }>
  cc?: Array<{ email: string }>
  bcc?: Array<{ email: string }>
  dynamic_template_data?: Record<string, unknown>
}

export interface SendGridAttachment {
  content: string
  filename: string
  type?: string
  disposition?: string
  content_id?: string
}

export interface SendGridMailBody {
  personalizations: SendGridPersonalization[]
  from: { email: string; name?: string }
  subject?: string
  template_id?: string
  content?: Array<{ type: 'text/plain' | 'text/html'; value?: string }>
  reply_to?: { email: string; name?: string }
  attachments?: SendGridAttachment[] | UserFile[]
}

export interface SendGridContactObject {
  email: string
  first_name?: string
  last_name?: string
  [key: string]: unknown
}

export interface SendGridContactRequest {
  contacts: SendGridContactObject[]
  list_ids?: string[]
}

export interface SendGridTemplateVersionRequest {
  name: string
  subject: string
  active: number | boolean
  html_content?: string
  plain_content?: string
}

// Common types
export interface SendGridBaseParams {
  apiKey: string
}

export interface SendMailParams extends SendGridBaseParams {
  from: string
  fromName?: string
  to: string
  toName?: string
  subject?: string
  content?: string
  contentType?: 'text/plain' | 'text/html'
  cc?: string
  bcc?: string
  replyTo?: string
  replyToName?: string
  attachments?: UserFile[] | SendGridAttachment[] | string
  templateId?: string
  dynamicTemplateData?: string
}

export interface SendMailResult extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    to: string
    subject: string
  }
}

// Contact Management types
export interface AddContactParams extends SendGridBaseParams {
  email: string
  firstName?: string
  lastName?: string
  customFields?: string // JSON string
  listIds?: string // Comma-separated list IDs
}

export interface UpdateContactParams extends SendGridBaseParams {
  contactId?: string
  email: string
  firstName?: string
  lastName?: string
  customFields?: string // JSON string
  listIds?: string // Comma-separated list IDs
}

export interface SearchContactsParams extends SendGridBaseParams {
  query: string
}

export interface GetContactParams extends SendGridBaseParams {
  contactId: string
}

export interface DeleteContactParams extends SendGridBaseParams {
  contactIds: string // Comma-separated contact IDs
}

export interface ContactResult extends ToolResponse {
  output: {
    id?: string
    jobId?: string
    email: string
    firstName?: string
    lastName?: string
    createdAt?: string
    updatedAt?: string
    listIds?: string[]
    customFields?: Record<string, unknown>
    message?: string
  }
}

export interface ContactsResult extends ToolResponse {
  output: {
    contacts: SendGridContact[]
    contactCount?: number
  }
}

// List Management types
export interface CreateListParams extends SendGridBaseParams {
  name: string
}

export interface GetListParams extends SendGridBaseParams {
  listId: string
}

export interface UpdateListParams extends SendGridBaseParams {
  listId: string
  name: string
}

export interface DeleteListParams extends SendGridBaseParams {
  listId: string
}

export interface ListAllListsParams extends SendGridBaseParams {
  pageSize?: number
}

export interface AddContactsToListParams extends SendGridBaseParams {
  listId: string
  contacts: string // JSON string array of contact objects with at least email
}

export interface RemoveContactsFromListParams extends SendGridBaseParams {
  listId: string
  contactIds: string // Comma-separated contact IDs
}

export interface ListResult extends ToolResponse {
  output: {
    id: string
    name: string
    contactCount?: number
  }
}

export interface ListsResult extends ToolResponse {
  output: {
    lists: SendGridList[]
  }
}

// Template types
export interface CreateTemplateParams extends SendGridBaseParams {
  name: string
  generation: 'legacy' | 'dynamic'
}

export interface GetTemplateParams extends SendGridBaseParams {
  templateId: string
}

export interface UpdateTemplateParams extends SendGridBaseParams {
  templateId: string
  name: string
}

export interface DeleteTemplateParams extends SendGridBaseParams {
  templateId: string
}

export interface ListTemplatesParams extends SendGridBaseParams {
  generations?: string // 'legacy' or 'dynamic' or both
  pageSize?: number
}

export interface CreateTemplateVersionParams extends SendGridBaseParams {
  templateId: string
  name: string
  subject: string
  htmlContent?: string
  plainContent?: string
  active?: boolean
}

export interface TemplateResult extends ToolResponse {
  output: {
    id: string
    name: string
    generation: string
    updatedAt?: string
    versions?: SendGridTemplateVersion[]
  }
}

export interface TemplatesResult extends ToolResponse {
  output: {
    templates: SendGridTemplate[]
  }
}

export interface TemplateVersionResult extends ToolResponse {
  output: {
    id: string
    templateId: string
    name: string
    subject: string
    active: boolean
    htmlContent?: string
    plainContent?: string
    updatedAt?: string
  }
}
