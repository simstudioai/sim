export interface FormField {
  id: string
  name: string
  label: string
  type: 'text' | 'email' | 'textarea' | 'number' | 'select' | 'checkbox'
  placeholder?: string
  required: boolean
  options?: string[]
}

export interface FormConfig {
  fields: FormField[]
  title?: string
  description?: string
  settings?: FormSettings
}

export interface FormSettings {
  successMessage: string
  redirectUrl?: string
  submitButtonText: string
}

export interface FormSubmissionPayload {
  formId: string
  workflowId: string
  userId: string
  formData: Record<string, any>
  headers: Record<string, string>
  path: string
  blockId?: string
}

export interface FormExecutionResult {
  success: boolean
  workflowId: string
  executionId: string
  output?: any
  executedAt: string
  formId: string
  error?: string
}
