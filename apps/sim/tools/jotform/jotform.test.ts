/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { addLabelResourcesTool } from '@/tools/jotform/add_label_resources'
import { createFormTool } from '@/tools/jotform/create_form'
import { createQuestionsTool } from '@/tools/jotform/create_questions'
import { createSubmissionTool } from '@/tools/jotform/create_submission'
import { createSubmissionsTool } from '@/tools/jotform/create_submissions'
import { createWebhookTool } from '@/tools/jotform/create_webhook'
import { getFormTool } from '@/tools/jotform/get_form'
import { listFormSubmissionsTool } from '@/tools/jotform/list_form_submissions'
import { listLabelsTool } from '@/tools/jotform/list_labels'
import { listWebhooksTool } from '@/tools/jotform/list_webhooks'
import { normalizeSubmission } from '@/tools/jotform/normalize'
import { updateFormPropertiesTool } from '@/tools/jotform/update_form_properties'
import { normalizeSubmissionAnswers, parseJotformResponse, toFormBody } from '@/tools/jotform/utils'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const auth = { apiKey: 'key-123' }

describe('jotform request building', () => {
  it('routes each region to its own host', () => {
    const url = (region?: string) =>
      (getFormTool.request.url as (p: Record<string, unknown>) => string)({
        ...auth,
        region,
        formId: '2315',
      })

    expect(url()).toBe('https://api.jotform.com/form/2315')
    expect(url('us')).toBe('https://api.jotform.com/form/2315')
    expect(url('eu')).toBe('https://eu-api.jotform.com/form/2315')
    expect(url('hipaa')).toBe('https://hipaa-api.jotform.com/form/2315')
    expect(() => url('apac')).toThrow(/Unknown Jotform region/)
  })

  it('sends the API key as a header rather than a query parameter', () => {
    const headers = (getFormTool.request.headers as (p: Record<string, unknown>) => object)({
      ...auth,
      formId: '2315',
    })

    expect(headers).toEqual({ APIKEY: 'key-123' })
  })

  /**
   * Untouched subblocks serialize as empty strings and are merged into the tool
   * params underneath the block mapper, so every optional query value has to
   * survive that as "absent" rather than as `?limit=`.
   */
  it('drops blank pagination values instead of sending empty query parameters', () => {
    const url = (listFormSubmissionsTool.request.url as (p: Record<string, unknown>) => string)({
      ...auth,
      formId: '2315',
      limit: '  ',
      offset: '',
      orderby: '',
      direction: '',
      filter: '',
    })

    expect(url).toBe('https://api.jotform.com/form/2315/submissions')
  })

  it('serializes filters as JSON and normalizes the sort direction', () => {
    const url = (listFormSubmissionsTool.request.url as (p: Record<string, unknown>) => string)({
      ...auth,
      formId: '2315',
      limit: '50',
      direction: 'desc',
      filter: { new: '1' },
    })
    const parsed = new URL(url)

    expect(parsed.searchParams.get('limit')).toBe('50')
    expect(parsed.searchParams.get('direction')).toBe('DESC')
    expect(parsed.searchParams.get('filter')).toBe('{"new":"1"}')
  })

  it('refuses to build a path with a missing identifier', () => {
    expect(() =>
      (getFormTool.request.url as (p: Record<string, unknown>) => string)({ ...auth, formId: '' })
    ).toThrow(/formId is required/)
  })
})

describe('toFormBody', () => {
  /**
   * Jotform reads PHP bracket notation, not JSON, so a nested answer has to become
   * `submission[3][first]` — a JSON body is accepted with a 200 and silently stores
   * nothing.
   */
  it('flattens nested objects into bracketed keys', () => {
    const body = toFormBody({ submission: { 3: { first: 'Bart', last: 'Simpson' }, 4: 'Hello' } })

    expect(body.split('&').sort()).toEqual([
      'submission%5B3%5D%5Bfirst%5D=Bart',
      'submission%5B3%5D%5Blast%5D=Simpson',
      'submission%5B4%5D=Hello',
    ])
  })

  it('indexes arrays and skips null values', () => {
    expect(toFormBody({ q: ['a', 'b'], skipped: null })).toBe('q%5B0%5D=a&q%5B1%5D=b')
  })
})

describe('create submission body', () => {
  it('declares the form content type so the transport passes the string through', () => {
    const headers = (
      createSubmissionTool.request.headers as (p: Record<string, unknown>) => object
    )(auth)

    expect(headers).toEqual({
      APIKEY: 'key-123',
      'Content-Type': 'application/x-www-form-urlencoded',
    })
  })

  it('accepts answers as a JSON string, the shape a direct tool call sends', () => {
    const body = (createSubmissionTool.request.body as (p: Record<string, unknown>) => string)({
      ...auth,
      formId: '2315',
      answers: '{"4":"Hello"}',
    })

    expect(body).toBe('submission%5B4%5D=Hello')
  })

  it('rejects an empty answer set rather than posting a blank submission', () => {
    expect(() =>
      (createSubmissionTool.request.body as (p: Record<string, unknown>) => string)({
        ...auth,
        formId: '2315',
        answers: {},
      })
    ).toThrow(/at least one question ID/)
  })
})

describe('parseJotformResponse', () => {
  /**
   * Jotform reports many failures with HTTP 200 and a non-2xx `responseCode` in the
   * body, so a check on `response.ok` alone would surface an error payload as a
   * successful tool result.
   */
  it('throws on a non-2xx responseCode carried inside a 200 response', async () => {
    await expect(
      parseJotformResponse(
        jsonResponse({ responseCode: 401, message: 'Invalid API Key' }),
        'Jotform Get Form'
      )
    ).rejects.toThrow('Jotform Get Form error (401): Invalid API Key')
  })

  it('throws on an HTTP error status', async () => {
    await expect(
      parseJotformResponse(jsonResponse({ message: 'Not found' }, 404), 'Jotform Get Form')
    ).rejects.toThrow('Jotform Get Form error (404): Not found')
  })

  it('reads the result window alongside the content', async () => {
    const envelope = await parseJotformResponse(
      jsonResponse({
        responseCode: 200,
        message: 'success',
        content: [],
        resultSet: { offset: 0, limit: 20, count: 3 },
        'limit-left': 4986,
      }),
      'Jotform List Forms'
    )

    expect(envelope.resultSet).toEqual({ offset: 0, limit: 20, count: 3 })
    expect(envelope.limitLeft).toBe(4986)
  })
})

describe('normalizeSubmission', () => {
  it('re-keys answers by question label, preferring prettyFormat', () => {
    const submission = normalizeSubmission({
      id: '237955080346633702',
      form_id: '31751954731962',
      created_at: '2013-06-25 03:38:00',
      status: 'ACTIVE',
      new: '1',
      answers: {
        '3': {
          text: 'Name',
          type: 'control_fullname',
          answer: { first: 'Bart', last: 'Simpson' },
          prettyFormat: 'Bart Simpson',
        },
        '4': { text: 'Your Message', type: 'control_textarea', answer: 'Hi there' },
        '5': { text: 'Skipped', type: 'control_textbox' },
      },
    })

    expect(submission.values).toEqual({ Name: 'Bart Simpson', 'Your Message': 'Hi there' })
    expect(submission.answers['3'].answer).toEqual({ first: 'Bart', last: 'Simpson' })
    expect(submission.workflowStatus).toBeNull()
  })
})

describe('webhook responses', () => {
  /**
   * The webhook list arrives as an id-keyed map, and that key is the ID the delete
   * endpoint takes — flattening to a bare URL list would throw it away.
   */
  it('keeps the map key as the webhook ID', async () => {
    const result = await listWebhooksTool.transformResponse!(
      jsonResponse({
        responseCode: 200,
        message: 'success',
        content: { '0': 'https://a.example/hook', '1': 'https://b.example/hook' },
      }),
      {} as never
    )

    expect(result.output.webhooks).toEqual([
      { id: '0', url: 'https://a.example/hook' },
      { id: '1', url: 'https://b.example/hook' },
    ])
  })

  it('reads the array form the create endpoint documents', async () => {
    const result = await createWebhookTool.transformResponse!(
      jsonResponse({ responseCode: 200, message: 'success', content: ['https://a.example/hook'] }),
      {} as never
    )

    expect(result.output.webhooks).toEqual([{ id: '0', url: 'https://a.example/hook' }])
  })
})

describe('single-resource unwrapping', () => {
  /**
   * `GET /form/{id}` is documented returning its single form inside an array, while
   * sibling endpoints return a bare object. Both shapes have to land on one form.
   */
  it('accepts the form both as an object and wrapped in an array', async () => {
    const form = { id: '2315', title: 'Contact Us', status: 'ENABLED', count: '755' }

    const fromArray = await getFormTool.transformResponse!(
      jsonResponse({ responseCode: 200, message: 'success', content: [form] }),
      {} as never
    )
    const fromObject = await getFormTool.transformResponse!(
      jsonResponse({ responseCode: 200, message: 'success', content: form }),
      {} as never
    )

    expect(fromArray.output.form.id).toBe('2315')
    expect(fromArray.output.form).toEqual(fromObject.output.form)
    expect(fromArray.output.form.title).toBe('Contact Us')
    expect(fromArray.output.form.url).toBeNull()
  })
})

describe('envelope-wrapped PUT bodies', () => {
  /**
   * `PUT /form/{id}/properties` and `PUT /form/{id}/questions` each read a named
   * envelope, while `PUT /form` and the bulk-submission PUT read their payload bare.
   * Sending the wrong one is accepted with a 200 and changes nothing, so each shape
   * is pinned against the request sample it came from.
   */
  it('wraps form properties in a properties envelope', () => {
    const body = (updateFormPropertiesTool.request.body as (p: Record<string, unknown>) => object)({
      ...auth,
      formId: '2315',
      properties: { formWidth: '650' },
    })

    expect(body).toEqual({ properties: { formWidth: '650' } })
  })

  it('wraps bulk questions in a questions envelope keyed from 1', () => {
    const body = (createQuestionsTool.request.body as (p: Record<string, unknown>) => object)({
      ...auth,
      formId: '2315',
      questions: [
        { type: 'control_head', text: 'Text 1' },
        { type: 'control_head', text: 'Text 2' },
      ],
    })

    expect(body).toEqual({
      questions: {
        '1': { type: 'control_head', text: 'Text 1' },
        '2': { type: 'control_head', text: 'Text 2' },
      },
    })
  })

  it('sends bulk submissions as a bare array', () => {
    const body = (createSubmissionsTool.request.body as (p: Record<string, unknown>) => unknown)({
      ...auth,
      formId: '2315',
      submissions: [{ '1': { text: 'Answer 1' } }],
    })

    expect(body).toEqual([{ '1': { text: 'Answer 1' } }])
  })

  it('sends a new form without an envelope', () => {
    const body = (createFormTool.request.body as (p: Record<string, unknown>) => object)({
      ...auth,
      questions: [{ type: 'control_email', text: 'Email', order: '1', name: 'email' }],
      properties: { title: 'Contact Us' },
    })

    expect(body).toEqual({
      questions: [{ type: 'control_email', text: 'Email', order: '1', name: 'email' }],
      properties: { title: 'Contact Us' },
    })
  })
})

describe('normalizeSubmissionAnswers', () => {
  /**
   * Jotform documents answers to multi-field questions in a `{qid}_{subfield}`
   * shorthand, and both official SDKs expand it to the nested wire form before
   * sending. Users copy the shorthand straight out of the docs.
   */
  it('expands the documented qid_subfield shorthand into nested answers', () => {
    expect(normalizeSubmissionAnswers({ '1_first': 'Johny', '1_last': 'Doe', '4': 'Hi' })).toEqual({
      '1': { first: 'Johny', last: 'Doe' },
      '4': 'Hi',
    })
  })

  it('leaves already-nested answers untouched', () => {
    expect(normalizeSubmissionAnswers({ '3': { first: 'Bart' } })).toEqual({
      '3': { first: 'Bart' },
    })
  })

  /**
   * `created_at` looks exactly like the shorthand and is not — splitting it would
   * post `submission[created][at]`. The official PHP SDK special-cases it by name.
   */
  it('keeps submission control keys whole', () => {
    expect(
      normalizeSubmissionAnswers({ created_at: '2026-01-01 00:00:00', new: '1', flag: '0' })
    ).toEqual({ created_at: '2026-01-01 00:00:00', new: '1', flag: '0' })
  })

  it('produces the bracket form the API reads once encoded', () => {
    const body = (createSubmissionTool.request.body as (p: Record<string, unknown>) => string)({
      ...auth,
      formId: '2315',
      answers: { '1_first': 'Johny' },
    })

    expect(body).toBe('submission%5B1%5D%5Bfirst%5D=Johny')
  })
})

describe('label resources', () => {
  it('normalizes the asset type to the lowercase form the request takes', () => {
    const body = (addLabelResourcesTool.request.body as (p: Record<string, unknown>) => object)({
      ...auth,
      labelId: 'lbl-1',
      resources: [{ id: '251464995493876', type: 'FORM' }],
    })

    expect(body).toEqual({ resources: [{ id: '251464995493876', type: 'form' }] })
  })

  it('rejects an asset missing its type rather than sending a partial reference', () => {
    expect(() =>
      (addLabelResourcesTool.request.body as (p: Record<string, unknown>) => object)({
        ...auth,
        labelId: 'lbl-1',
        resources: [{ id: '251464995493876' }],
      })
    ).toThrow(/needs both an id and a type/)
  })

  /**
   * `GET /user/labels` returns a root label whose `sublabels` nest without a
   * documented depth bound, so the walk is capped rather than trusting the payload.
   */
  it('preserves the label tree and caps runaway nesting', async () => {
    const result = await listLabelsTool.transformResponse!(
      jsonResponse({
        responseCode: 200,
        message: 'success',
        content: {
          id: 'root',
          sublabels: [{ id: 'child', name: 'Finance', color: '#59BED2', sublabels: [] }],
        },
      }),
      {} as never
    )

    expect(result.output.labels).toHaveLength(1)
    expect(result.output.labels[0].sublabels[0]).toMatchObject({ id: 'child', name: 'Finance' })

    let deep: Record<string, unknown> = { id: 'leaf', sublabels: [] }
    for (let i = 0; i < 60; i++) deep = { id: `n${i}`, sublabels: [deep] }
    const capped = await listLabelsTool.transformResponse!(
      jsonResponse({ responseCode: 200, message: 'success', content: [deep] }),
      {} as never
    )

    let depth = 0
    let node = capped.output.labels[0]
    while (node?.sublabels?.length) {
      node = node.sublabels[0]
      depth++
    }
    expect(depth).toBeLessThanOrEqual(32)
  })
})

describe('error envelope robustness', () => {
  /**
   * Jotform quotes `responseCode` on some endpoints and not others. A
   * `typeof === 'number'` test silently skips the check on the quoted ones, turning
   * an auth failure into a successful tool result with empty output.
   */
  it('throws on a quoted non-2xx responseCode', async () => {
    await expect(
      parseJotformResponse(
        jsonResponse({ responseCode: '401', message: 'Invalid API Key' }),
        'Jotform Get Form'
      )
    ).rejects.toThrow('Jotform Get Form error (401): Invalid API Key')
  })

  /** An upstream gateway can answer with an HTML page instead of the JSON envelope. */
  it('caps a non-JSON error body instead of inlining the whole page', async () => {
    const page = `<html>${'x'.repeat(5000)}</html>`
    await expect(
      parseJotformResponse(new Response(page, { status: 502 }), 'Jotform Get Form')
    ).rejects.toThrow(/^Jotform Get Form error \(502\): .{1,320}$/s)
  })
})

describe('duplicate question labels', () => {
  /**
   * Question labels are not unique — a form can carry two questions both labelled
   * "Email". Keying `values` on the label alone silently dropped all but the last,
   * handing downstream workflows a confidently wrong answer.
   */
  it('disambiguates every occurrence of a repeated label with its question ID', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: {
        '3': { text: 'Email', type: 'control_email', answer: 'first@example.com' },
        '7': { text: 'Email', type: 'control_email', answer: 'second@example.com' },
        '9': { text: 'Message', type: 'control_textarea', answer: 'Hello' },
      },
    })

    expect(submission.values).toEqual({
      'Email (3)': 'first@example.com',
      'Email (7)': 'second@example.com',
      Message: 'Hello',
    })
    /* Never an arbitrary winner under the bare key. */
    expect(submission.values.Email).toBeUndefined()
  })

  it('keeps a unique label bare', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: { '3': { text: 'Email', type: 'control_email', answer: 'only@example.com' } },
    })

    expect(submission.values).toEqual({ Email: 'only@example.com' })
  })

  /** The id-keyed record stays complete regardless of how labels collide. */
  it('never loses an answer from the id-keyed record', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: {
        '3': { text: 'Email', type: 'control_email', answer: 'a@example.com' },
        '7': { text: 'Email', type: 'control_email', answer: 'b@example.com' },
      },
    })

    expect(Object.keys(submission.answers)).toEqual(['3', '7'])
    expect(submission.answers['3'].answer).toBe('a@example.com')
    expect(submission.answers['7'].answer).toBe('b@example.com')
  })
})

describe('duplicate label key collisions', () => {
  /**
   * Labels are free text, so the disambiguation key is not automatically safe either:
   * a question literally labelled "Email (3)" lands on the key generated for a
   * duplicate "Email" at qid 3.
   */
  it('widens a generated key that collides with a literal label', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: {
        '3': { text: 'Email', type: 'control_email', answer: 'dup-a@example.com' },
        '5': { text: 'Email', type: 'control_email', answer: 'dup-b@example.com' },
        '9': { text: 'Email (3)', type: 'control_textbox', answer: 'literal' },
      },
    })

    expect(Object.keys(submission.values)).toHaveLength(3)
    expect(new Set(Object.values(submission.values))).toEqual(
      new Set(['dup-a@example.com', 'dup-b@example.com', 'literal'])
    )
  })

  /**
   * Assigning `__proto__` onto an object literal sets the prototype rather than an
   * own property, so the answer would vanish from the map entirely.
   */
  it('keeps an answer labelled __proto__ as a real own property', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: { '3': { text: '__proto__', type: 'control_textbox', answer: 'kept' } },
    })

    expect(Object.hasOwn(submission.values, '__proto__')).toBe(true)
    expect(Object.values(submission.values)).toContain('kept')
  })

  /** The guarantee is a count: every rendered answer reaches the map. */
  it('never drops a rendered answer, whatever the labels are', () => {
    const submission = normalizeSubmission({
      id: '1',
      answers: {
        '1': { text: 'X', type: 'control_textbox', answer: 'a' },
        '2': { text: 'X', type: 'control_textbox', answer: 'b' },
        '3': { text: 'X (1)', type: 'control_textbox', answer: 'c' },
        '4': { text: 'X (2)', type: 'control_textbox', answer: 'd' },
        '5': { text: 'X (2) (2)', type: 'control_textbox', answer: 'e' },
      },
    })

    expect(Object.keys(submission.values)).toHaveLength(5)
    expect(new Set(Object.values(submission.values))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
  })
})
