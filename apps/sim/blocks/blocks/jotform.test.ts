/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { JotformBlock } from '@/blocks/blocks/jotform'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('JotformBlock', () => {
  const buildParams = JotformBlock.tools.config.params!
  const selectTool = JotformBlock.tools.config.tool!

  const operationIds =
    JotformBlock.subBlocks
      .find((subBlock) => subBlock.id === 'operation')
      ?.options?.map((option) => (option as { id: string }).id) ?? []

  it('maps every dropdown operation onto a registered tool', () => {
    expect(operationIds).toHaveLength(43)
    expect(new Set(operationIds.map((id) => selectTool({ operation: id })))).toEqual(
      new Set(JotformBlock.tools.access)
    )
  })

  /* Trigger-mode subBlocks are supplied by the trigger config and carry their own
     state, so neither the input declarations nor the tool-mode id space covers them. */
  const toolSubBlocks = JotformBlock.subBlocks.filter((subBlock) => subBlock.mode !== 'trigger')

  it('declares an input for every subblock', () => {
    const inputIds = new Set(Object.keys(JotformBlock.inputs))
    const missing = toolSubBlocks.map((subBlock) => subBlock.id).filter((id) => !inputIds.has(id))

    expect(missing).toEqual([])
  })

  it('gives every subblock a unique id', () => {
    const ids = toolSubBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * `properties`, `text`, `order`, `name`, `title`, and `fields` are tool params on
   * one operation and would be meaningless on another. Naming a subblock after one
   * of them would leak its stale value into every other operation through the raw
   * merge, so each is deliberately carried by a prefixed subblock instead.
   */
  it('never names a subblock after a param another operation owns', () => {
    const contested = ['properties', 'questions', 'emails', 'text', 'order', 'name', 'title']
    const collisions = JotformBlock.subBlocks
      .map((subBlock) => subBlock.id)
      .filter((id) => contested.includes(id))

    expect(collisions).toEqual([])
  })

  it('renames the create-form subblocks onto the tool params', () => {
    const inputs = {
      operation: 'create_form',
      apiKey: 'key',
      newFormQuestions: '[{"type":"control_email","text":"Email","order":"1","name":"email"}]',
      newFormProperties: '{"title":"Contact Us"}',
      newFormEmails: '[{"type":"notification","to":"team@example.com"}]',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.questions).toBe(inputs.newFormQuestions)
    expect(finalInputs.properties).toBe(inputs.newFormProperties)
    expect(finalInputs.emails).toBe(inputs.newFormEmails)
  })

  it('renames the question subblocks onto the tool params', () => {
    const inputs = {
      operation: 'create_question',
      apiKey: 'key',
      formId: '2315',
      questionType: 'control_email',
      questionText: 'Your email',
      questionOrder: '2',
      questionName: 'yourEmail',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.text).toBe('Your email')
    expect(finalInputs.order).toBe('2')
    expect(finalInputs.name).toBe('yourEmail')
    expect(finalInputs.questionType).toBe('control_email')
  })

  it('renames the report subblocks onto the tool params', () => {
    const inputs = {
      operation: 'create_report',
      apiKey: 'key',
      formId: '2315',
      reportTitle: 'Weekly responses',
      reportType: 'csv',
      reportFields: 'ip,dt,3,4',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.title).toBe('Weekly responses')
    expect(finalInputs.listType).toBe('csv')
    expect(finalInputs.fields).toBe('ip,dt,3,4')
  })

  it('renames the bulk subblocks onto the tool params', () => {
    const submissions = {
      operation: 'create_submissions',
      apiKey: 'key',
      formId: '2315',
      bulkSubmissions: '[{"1":{"text":"a"}}]',
    }
    expect({ ...submissions, ...buildParams(submissions) }.submissions).toBe(
      submissions.bulkSubmissions
    )

    const questions = {
      operation: 'create_questions',
      apiKey: 'key',
      formId: '2315',
      bulkQuestions: '[{"type":"control_head"}]',
    }
    expect({ ...questions, ...buildParams(questions) }.questions).toBe(questions.bulkQuestions)
  })

  /**
   * `create_form` and `create_questions` both feed a `questions` tool param from
   * different subblocks. A leftover value from one must not arrive as the other.
   */
  it('keeps the two questions sources from bleeding into each other', () => {
    const inputs = {
      operation: 'create_questions',
      apiKey: 'key',
      formId: '2315',
      bulkQuestions: '[{"type":"control_head"}]',
      newFormQuestions: '[{"type":"control_email"}]',
    }

    expect({ ...inputs, ...buildParams(inputs) }.questions).toBe(inputs.bulkQuestions)
  })

  it('renames the history subblocks onto the tool params', () => {
    const inputs = {
      operation: 'get_history',
      apiKey: 'key',
      historyAction: 'formCreation',
      historySortBy: 'ASC',
      historyStartDate: '01/01/2026',
      historyEndDate: '02/01/2026',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.action).toBe('formCreation')
    expect(finalInputs.sortBy).toBe('ASC')
    expect(finalInputs.startDate).toBe('01/01/2026')
    expect(finalInputs.endDate).toBe('02/01/2026')
  })

  /**
   * A leftover value from a previously selected operation still reaches the mapper.
   * The rename must not fire for the operation that does not own it, or a stale
   * report title would arrive as a question label.
   */
  it('leaves renames untouched for operations that do not own them', () => {
    const inputs = {
      operation: 'list_form_submissions',
      apiKey: 'key',
      formId: '2315',
      reportTitle: 'Left over from an earlier operation',
      questionText: 'Also left over',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.title).toBeUndefined()
    expect(finalInputs.text).toBeUndefined()
    expect(finalInputs.listType).toBeUndefined()
  })

  it('marks the identifier each operation addresses as required', () => {
    const requiredFor = (id: string) => {
      const subBlock = JotformBlock.subBlocks.find((candidate) => candidate.id === id)
      const required = subBlock?.required as { field: string; value: string | string[] } | undefined
      const value = required?.value ?? []
      return Array.isArray(value) ? value : [value]
    }

    expect(requiredFor('formId')).toContain('list_form_submissions')
    expect(requiredFor('submissionId')).toEqual([
      'get_submission',
      'update_submission',
      'delete_submission',
    ])
    expect(requiredFor('questionId')).toEqual([
      'get_question',
      'update_question',
      'delete_question',
    ])
    expect(requiredFor('reportId')).toEqual(['get_report', 'delete_report'])
    expect(requiredFor('webhookId')).toEqual(['delete_webhook'])
  })
})
