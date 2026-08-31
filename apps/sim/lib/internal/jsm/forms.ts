import type {
  JsmAttachFormBody,
  JsmCopyFormsBody,
  JsmDeleteFormBody,
  JsmExternaliseFormBody,
  JsmFormAnswersBody,
  JsmGetFormBody,
  JsmInternaliseFormBody,
  JsmIssueFormsBody,
  JsmProjectFormStructureBody,
  JsmProjectFormTemplatesBody,
  JsmReopenFormBody,
  JsmSaveFormAnswersBody,
  JsmSubmitFormBody,
} from '@/lib/api/contracts/tools/jsm'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { asArray, asObject, createJsmClient, nested } from '@/lib/internal/jsm/client'
import { JsmOperationError } from '@/lib/internal/jsm/errors'

type IssueFormInput =
  | JsmGetFormBody
  | JsmSubmitFormBody
  | JsmDeleteFormBody
  | JsmExternaliseFormBody
  | JsmInternaliseFormBody
  | JsmReopenFormBody
  | JsmSaveFormAnswersBody
  | JsmFormAnswersBody

function validateIssueKey(value: string, field: string): void {
  const validation = validateJiraIssueKey(value, field)
  if (!validation.isValid) throw new JsmOperationError(validation.error || `Invalid ${field}`, 400)
}

function validateFormId(value: string, field = 'formId'): void {
  const validation = validateJiraCloudId(value, field)
  if (!validation.isValid) throw new JsmOperationError(validation.error || `Invalid ${field}`, 400)
}

async function issueFormClient(input: IssueFormInput, signal?: AbortSignal) {
  validateIssueKey(input.issueIdOrKey, 'issueIdOrKey')
  validateFormId(input.formId)
  return createJsmClient(input, signal)
}

function issueFormPath(issueIdOrKey: string, formId?: string): string {
  const issue = encodeURIComponent(issueIdOrKey)
  return formId ? `/issue/${issue}/form/${encodeURIComponent(formId)}` : `/issue/${issue}/form`
}

export async function executeJsmGetIssueForms(input: JsmIssueFormsBody, signal?: AbortSignal) {
  validateIssueKey(input.issueIdOrKey, 'issueIdOrKey')
  const client = await createJsmClient(input, signal)
  const value = await client.value(
    client.forms(issueFormPath(input.issueIdOrKey)),
    {},
    signal,
    true
  )
  const data = asObject(value)
  const forms = Array.isArray(value) ? value : asArray(data.values ?? data.forms)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      forms: forms.map((entry) => {
        const form = asObject(entry)
        return {
          id: form.id ?? null,
          name: form.name ?? null,
          updated: form.updated ?? null,
          submitted: form.submitted ?? false,
          lock: form.lock ?? false,
          internal: form.internal ?? null,
          formTemplateId: nested(form, 'formTemplate', 'id') ?? null,
        }
      }),
      total: forms.length,
    },
  }
}

export async function executeJsmAttachForm(input: JsmAttachFormBody, signal?: AbortSignal) {
  validateIssueKey(input.issueIdOrKey, 'issueIdOrKey')
  validateFormId(input.formTemplateId, 'formTemplateId')
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.forms(issueFormPath(input.issueIdOrKey)),
    { method: 'POST', body: JSON.stringify({ formTemplate: { id: input.formTemplateId } }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      id: data.id ?? null,
      name: data.name ?? null,
      updated: data.updated ?? null,
      submitted: data.submitted ?? false,
      lock: data.lock ?? false,
      internal: data.internal ?? null,
      formTemplateId: nested(data, 'formTemplate', 'id') ?? null,
    },
  }
}

export async function executeJsmGetForm(input: JsmGetFormBody, signal?: AbortSignal) {
  const client = await issueFormClient(input, signal)
  const data = await client.json(
    client.forms(issueFormPath(input.issueIdOrKey, input.formId)),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      formId: input.formId,
      design: data.design ?? null,
      state: data.state ?? null,
      updated: data.updated ?? null,
    },
  }
}

async function executeFormAction(
  input: IssueFormInput,
  action: string,
  fallbackField: 'status' | 'visibility',
  fallbackValue: string,
  signal?: AbortSignal
) {
  const client = await issueFormClient(input, signal)
  const data = await client.optionalJson(
    client.forms(`${issueFormPath(input.issueIdOrKey, input.formId)}/action/${action}`),
    { method: 'PUT' },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      formId: input.formId,
      [fallbackField]: data[fallbackField] ?? fallbackValue,
    },
  }
}

export function executeJsmSubmitForm(input: JsmSubmitFormBody, signal?: AbortSignal) {
  return executeFormAction(input, 'submit', 'status', 'submitted', signal)
}

export async function executeJsmDeleteForm(input: JsmDeleteFormBody, signal?: AbortSignal) {
  const client = await issueFormClient(input, signal)
  await client.empty(
    client.forms(issueFormPath(input.issueIdOrKey, input.formId)),
    { method: 'DELETE' },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      formId: input.formId,
      deleted: true,
    },
  }
}

export function executeJsmExternaliseForm(input: JsmExternaliseFormBody, signal?: AbortSignal) {
  return executeFormAction(input, 'external', 'visibility', 'external', signal)
}

export function executeJsmInternaliseForm(input: JsmInternaliseFormBody, signal?: AbortSignal) {
  return executeFormAction(input, 'internal', 'visibility', 'internal', signal)
}

export function executeJsmReopenForm(input: JsmReopenFormBody, signal?: AbortSignal) {
  return executeFormAction(input, 'reopen', 'status', 'open', signal)
}

export async function executeJsmSaveFormAnswers(
  input: JsmSaveFormAnswersBody,
  signal?: AbortSignal
) {
  const client = await issueFormClient(input, signal)
  const data = await client.json(
    client.forms(issueFormPath(input.issueIdOrKey, input.formId)),
    { method: 'PUT', body: JSON.stringify({ answers: input.answers }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      formId: input.formId,
      state: data.state ?? null,
      updated: data.updated ?? null,
    },
  }
}

export async function executeJsmGetFormAnswers(input: JsmFormAnswersBody, signal?: AbortSignal) {
  const client = await issueFormClient(input, signal)
  const answers = await client.value(
    client.forms(`${issueFormPath(input.issueIdOrKey, input.formId)}/format/answers`),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      formId: input.formId,
      answers: answers ?? null,
    },
  }
}

export async function executeJsmGetFormTemplates(
  input: JsmProjectFormTemplatesBody,
  signal?: AbortSignal
) {
  validateIssueKey(input.projectIdOrKey, 'projectIdOrKey')
  const client = await createJsmClient(input, signal)
  const value = await client.value(
    client.forms(`/project/${encodeURIComponent(input.projectIdOrKey)}/form`),
    {},
    signal,
    true
  )
  const data = asObject(value)
  const templates = Array.isArray(value) ? value : asArray(data.values)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      projectIdOrKey: input.projectIdOrKey,
      templates: templates.map((entry) => {
        const template = asObject(entry)
        return {
          id: template.id ?? null,
          name: template.name ?? null,
          updated: template.updated ?? null,
          issueCreateIssueTypeIds: template.issueCreateIssueTypeIds ?? [],
          issueCreateRequestTypeIds: template.issueCreateRequestTypeIds ?? [],
          portalRequestTypeIds: template.portalRequestTypeIds ?? [],
          recommendedIssueRequestTypeIds: template.recommendedIssueRequestTypeIds ?? [],
        }
      }),
      total: templates.length,
    },
  }
}

export async function executeJsmGetFormStructure(
  input: JsmProjectFormStructureBody,
  signal?: AbortSignal
) {
  validateIssueKey(input.projectIdOrKey, 'projectIdOrKey')
  validateFormId(input.formId)
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.forms(
      `/project/${encodeURIComponent(input.projectIdOrKey)}/form/${encodeURIComponent(input.formId)}`
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      projectIdOrKey: input.projectIdOrKey,
      formId: input.formId,
      design: data.design ?? null,
      updated: data.updated ?? null,
      publish: data.publish ?? null,
    },
  }
}

export async function executeJsmCopyForms(input: JsmCopyFormsBody, signal?: AbortSignal) {
  validateIssueKey(input.sourceIssueIdOrKey, 'sourceIssueIdOrKey')
  validateIssueKey(input.targetIssueIdOrKey, 'targetIssueIdOrKey')
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.forms(
      `/issue/${encodeURIComponent(input.sourceIssueIdOrKey)}/form/copy/${encodeURIComponent(input.targetIssueIdOrKey)}`
    ),
    { method: 'POST', body: JSON.stringify(input.formIds?.length ? { ids: input.formIds } : {}) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      sourceIssueIdOrKey: input.sourceIssueIdOrKey,
      targetIssueIdOrKey: input.targetIssueIdOrKey,
      copiedForms: data.copiedForms ?? [],
      errors: data.errors ?? [],
    },
  }
}
