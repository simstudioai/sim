import type { AssistantActionsResponse } from '@/lib/api/contracts/assistant-actions'
import { humanizeDisplayIdentifier } from '@/lib/mothership/tools/display'

type PresentedAction = Pick<
  AssistantActionsResponse['actions'][number],
  'toolId' | 'name' | 'fields'
>

const CONTENT_TYPE_LABELS = new Map([
  ['text', 'Plain text'],
  ['html', 'HTML'],
])

/** Readable labels and enum text leave the reviewed invocation unchanged. */
export function assistantActionFieldPresentation(field: PresentedAction['fields'][number]) {
  const identifier = field.name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
  return {
    label:
      field.label === field.name ? humanizeDisplayIdentifier(identifier, 'sentence') : field.label,
    value:
      field.name === 'contentType'
        ? (CONTENT_TYPE_LABELS.get(field.value) ?? field.value)
        : field.value,
  }
}

/** Display labels and preview fields only; model-facing tool definitions remain unchanged. */
const PRESENTATIONS: Record<string, { title: string; primary: string[] }> = {
  gmail_draft_v2: { title: 'Draft email', primary: ['subject', 'body'] },
  gmail_send_v2: { title: 'Send email', primary: ['subject', 'body'] },
  google_docs_create: { title: 'Create Google Doc', primary: ['title', 'content'] },
  google_docs_write: { title: 'Update Google Doc', primary: ['content'] },
  google_sheets_write_v2: { title: 'Update spreadsheet', primary: ['values'] },
  jira_add_comment: { title: 'Add Jira comment', primary: ['body'] },
  jira_create_sprint: { title: 'Create Jira sprint', primary: ['name', 'goal'] },
  jira_update: { title: 'Update Jira issue', primary: ['summary', 'description'] },
  jira_write: { title: 'Create Jira issue', primary: ['summary', 'description'] },
  microsoft_excel_write_v2: { title: 'Update Excel spreadsheet', primary: ['values', 'formulas'] },
  microsoft_teams_write_channel: { title: 'Send Teams message', primary: ['content'] },
  microsoft_teams_write_chat: { title: 'Send Teams message', primary: ['content'] },
  outlook_draft: { title: 'Draft email', primary: ['subject', 'body'] },
  outlook_send: { title: 'Send email', primary: ['subject', 'body'] },
  salesforce_create_task: { title: 'Create Salesforce task', primary: ['subject', 'description'] },
  salesforce_update_task: { title: 'Update Salesforce task', primary: ['subject', 'description'] },
  slack_message: { title: 'Send Slack message', primary: ['blocks', 'text'] },
}

export function assistantActionPresentation(action: PresentedAction) {
  const presentation = PRESENTATIONS[action.toolId]
  const fields = action.fields.filter((field) => field.value !== '')
  const targets = fields.filter((field) => field.target)
  const primary = presentation
    ? presentation.primary.flatMap((name) =>
        fields.filter((field) => field.name === name && !field.target)
      )
    : fields.filter((field) => !field.target).slice(0, 2)
  const primaryNames = new Set(primary.map((field) => field.name))
  return {
    title: presentation?.title ?? action.name,
    targets,
    primary,
    details: fields.filter((field) => !field.target && !primaryNames.has(field.name)),
  }
}
