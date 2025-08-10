import type { ToolResponse } from '@/tools/types'

export interface WealthboxNote {
  id: number
  creator: number
  created_at: string
  updated_at: string
  content: string
  linked_to: Array<{
    id: number
    type: string
    name: string
  }>
  visible_to: string
  tags: Array<{
    id: number
    name: string
  }>
}

export interface WealthboxContact {
  id: number
  first_name: string
  last_name: string
  company_name?: string
  background_information?: string
  email_addresses?: Array<{
    address: string
    principal: boolean
    kind: string
  }>
  phone_numbers?: Array<{
    address: string
    principal: boolean
    extension?: string
    kind: string
  }>
}

export interface WealthboxTask {
  id: number
  name: string
  due_date: string
  description?: string
  complete?: boolean
  category?: number
  priority?: 'Low' | 'Medium' | 'High'
  linked_to?: Array<{
    id: number
    type: string
    name: string
  }>
  visible_to?: string
}

// Unified metadata structure
export interface WealthboxMetadata {
  operation:
    | 'read_note'
    | 'write_note'
    | 'read_contact'
    | 'write_contact'
    | 'read_task'
    | 'write_task'
  itemId?: string
  contactId?: string
  itemType: 'note' | 'contact' | 'task'
  totalItems?: number
}

// Unified output structure for all operations
interface WealthboxUniformOutput {
  // Single items (for write operations and single reads)
  note?: WealthboxNote
  contact?: WealthboxContact
  task?: WealthboxTask

  // Arrays (for bulk read operations)
  notes?: WealthboxNote[]
  contacts?: WealthboxContact[]
  tasks?: WealthboxTask[]

  // Operation result indicators
  success?: boolean
  metadata: WealthboxMetadata
}

// Both response types use identical structure
export interface WealthboxReadResponse extends ToolResponse {
  output: WealthboxUniformOutput
}

export interface WealthboxWriteResponse extends ToolResponse {
  output: WealthboxUniformOutput
}

// Unified parameter types
export interface WealthboxReadParams {
  accessToken: string
  operation: 'read_note' | 'read_contact' | 'read_task'
  noteId?: string
  contactId?: string
  taskId?: string
}

export interface WealthboxWriteParams {
  accessToken: string
  operation: 'write_note' | 'write_contact' | 'write_task'

  // IDs (optional for creating new items)
  noteId?: string
  contactId?: string
  taskId?: string

  // Note fields
  content?: string
  linkedTo?: Array<{
    id: number
    type: string
    name: string
  }>
  visibleTo?: string
  tags?: Array<{
    id: number
    name: string
  }>

  // Contact fields
  firstName?: string
  lastName?: string
  backgroundInformation?: string
  emailAddress?: string

  // Task fields
  title?: string
  description?: string
  dueDate?: string
  complete?: boolean
  category?: number
  priority?: 'Low' | 'Medium' | 'High'
}

export interface WealthboxTaskRequestBody {
  name: string
  due_date: string
  description?: string // Add this field
  complete?: boolean
  category?: number
  linked_to?: Array<{
    id: number
    type: string
  }>
}

export type WealthboxResponse = WealthboxReadResponse | WealthboxWriteResponse
