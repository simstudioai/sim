/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { slackListsCreateTool } from '@/tools/slack_lists/create'
import { slackListsItemsCreateTool } from '@/tools/slack_lists/items_create'
import { slackListsItemsDeleteTool } from '@/tools/slack_lists/items_delete'
import { slackListsItemsInfoTool } from '@/tools/slack_lists/items_info'
import { slackListsItemsListTool } from '@/tools/slack_lists/items_list'
import { slackListsItemsUpdateTool } from '@/tools/slack_lists/items_update'
import { slackListsUpdateTool } from '@/tools/slack_lists/update'

const auth = { accessToken: 'test-token' }
const item = { id: 'Rec123', list_id: 'F123', date_created: 1758744346, fields: [] }
const schema = [
  { id: 'Col123', key: 'title', name: 'Title', type: 'text', is_primary_column: true },
]
const list = { id: 'F123', title: 'Tasks', list_metadata: { schema } }
const richText = [
  {
    type: 'rich_text',
    elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Do this' }] }],
  },
]
const tools = [
  slackListsCreateTool,
  slackListsUpdateTool,
  slackListsItemsListTool,
  slackListsItemsInfoTool,
  slackListsItemsCreateTool,
  slackListsItemsUpdateTool,
  slackListsItemsDeleteTool,
]

describe('Slack Lists requests', () => {
  it('creates columns and encodes description as rich text', () => {
    expect(
      slackListsCreateTool.request.body!({
        ...auth,
        name: ' Tasks ',
        schema: '[{"key":"title","name":"Title","type":"text","is_primary_column":true}]',
        description: 'Our work',
        todoMode: false,
      })
    ).toEqual({
      name: 'Tasks',
      schema: [{ key: 'title', name: 'Title', type: 'text', is_primary_column: true }],
      description_blocks: [
        {
          type: 'rich_text',
          elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Our work' }] }],
        },
      ],
      todo_mode: false,
    })
  })
  it('uses id rather than list_id for renaming a List', () => {
    expect(
      slackListsUpdateTool.request.body!({ ...auth, listId: ' F123 ', name: 'Renamed' })
    ).toEqual({ id: 'F123', name: 'Renamed' })
  })
  it('preserves cursor and archived flags and requests schema by default', () => {
    expect(
      slackListsItemsListTool.request.body!({
        ...auth,
        listId: ' F123 ',
        cursor: 'cursor==',
        limit: 10,
        archived: false,
      })
    ).toEqual({
      list_id: 'F123',
      cursor: 'cursor==',
      limit: 10,
      archived: false,
      include_list: true,
    })
    expect(
      slackListsItemsListTool.request.body!({ ...auth, listId: 'F123', includeList: false })
    ).toMatchObject({ include_list: false })
    expect(() =>
      slackListsItemsListTool.request.body!({ ...auth, listId: 'F123', limit: 1.5 })
    ).toThrow()
    expect(() => slackListsItemsListTool.request.body!({ ...auth, listId: '', limit: 1 })).toThrow()
  })
  it('writes documented typed values, not response-shaped cells', () => {
    const initialFields = [
      { column_id: 'Col1', rich_text: richText },
      { column_id: 'Col2', checkbox: false },
      { column_id: 'Col3', number: [0] },
      { column_id: 'Col4', select: ['in_progress'] },
      { column_id: 'Col5', date: ['2026-09-23'] },
      { column_id: 'Col6', user: ['U123'] },
      { column_id: 'Col7', link: [{ original_url: 'https://example.com', display_as_url: false }] },
      { column_id: 'Col8', message: ['https://example.slack.com/archives/C123/p1234567890123456'] },
    ]
    expect(
      slackListsItemsCreateTool.request.body!({
        ...auth,
        listId: 'F123',
        initialFields: JSON.stringify(initialFields),
        parentItemId: ' Rec1 ',
      })
    ).toEqual({
      list_id: 'F123',
      initial_fields: initialFields,
      parent_item_id: 'Rec1',
      duplicated_item_id: undefined,
    })
  })
  it.each([
    '[{"column_id":"Col1","text":"not supported"}]',
    '[{"column_id":"Col1","checkbox":[true]}]',
    '[{"column_id":"Col1","number":[1],"select":["a"]}]',
    '[{"number":[1]}]',
    'not json',
    '{}',
  ])('rejects invalid fields %s before a request', (initialFields) => {
    expect(() =>
      slackListsItemsCreateTool.request.body!({ ...auth, listId: 'F123', initialFields })
    ).toThrow()
  })
  it('updates cells with row IDs and supports clearing array fields', () => {
    const cells = [
      { row_id: 'Rec1', column_id: 'Col1', user: [] },
      { row_id: 'Rec2', column_id: 'Col2', checkbox: false },
    ]
    expect(slackListsItemsUpdateTool.request.body!({ ...auth, listId: 'F123', cells })).toEqual({
      list_id: 'F123',
      cells,
    })
    expect(() =>
      slackListsItemsUpdateTool.request.body!({ ...auth, listId: 'F123', cells: '[]' })
    ).toThrow()
    expect(() =>
      slackListsItemsUpdateTool.request.body!({
        ...auth,
        listId: 'F123',
        cells: '[{"column_id":"Col1","number":[1]}]',
      })
    ).toThrow()
  })
  it.each([
    { message: { channel_id: 'C1', ts: '123.456' } },
    { list_record: { list_id: 'F1', row_id: 'Rec1' } },
    { file: { file_id: 'F1' } },
    { canvas_section: { file_id: 'F1', section_id: 'S1' } },
  ])('accepts a single typed reference %j for creates and updates', (reference) => {
    const field = { column_id: 'Col1', reference: [reference] }
    expect(
      slackListsItemsCreateTool.request.body!({ ...auth, listId: 'F123', initialFields: [field] })
    ).toMatchObject({ initial_fields: [field] })
    const cell = { ...field, row_id: 'Rec1' }
    expect(
      slackListsItemsUpdateTool.request.body!({ ...auth, listId: 'F123', cells: [cell] })
    ).toMatchObject({ cells: [cell] })
  })
  it.each([{}, { file: { file_id: 'F1' }, list_record: { list_id: 'F1', row_id: 'Rec1' } }])(
    'rejects ambiguous or empty references %j before creates and updates',
    (reference) => {
      const field = { column_id: 'Col1', reference: [reference] }
      expect(() =>
        slackListsItemsCreateTool.request.body!({ ...auth, listId: 'F123', initialFields: [field] })
      ).toThrow('Each reference must contain exactly one')
      expect(() =>
        slackListsItemsUpdateTool.request.body!({
          ...auth,
          listId: 'F123',
          cells: [{ ...field, row_id: 'Rec1' }],
        })
      ).toThrow('Each reference must contain exactly one')
    }
  )
  it('targets the row by id when reading or deleting', () => {
    for (const tool of [slackListsItemsInfoTool, slackListsItemsDeleteTool]) {
      expect(tool.request.body!({ ...auth, listId: ' F123 ', itemId: ' Rec1 ' })).toEqual({
        list_id: 'F123',
        id: 'Rec1',
      })
    }
  })
  it('uses only resolved credentials and action-specific scopes', () => {
    for (const tool of tools) {
      expect(tool.oauth?.provider).toBe('slack')
      expect(tool.oauth?.requiredScopes).toEqual([
        ['slack_lists_items_list', 'slack_lists_items_info'].includes(tool.id)
          ? 'lists:read'
          : 'lists:write',
      ])
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.request.headers!(auth)).toMatchObject({ Authorization: 'Bearer test-token' })
      expect(() => tool.request.headers!({ accessToken: '' })).toThrow()
    }
  })
})

describe('Slack Lists responses', () => {
  it('returns column IDs on creation without inventing an omitted schema', async () => {
    expect(
      (
        await slackListsCreateTool.transformResponse!(
          Response.json({ ok: true, list_id: 'F123', list_metadata: { schema } })
        )
      ).output
    ).toEqual({ listId: 'F123', schema })
    expect(
      (await slackListsCreateTool.transformResponse!(Response.json({ ok: true, list_id: 'F123' })))
        .output.schema
    ).toBeNull()
  })
  it('projects a page and its schema with the continuation cursor', async () => {
    const output = (
      await slackListsItemsListTool.transformResponse!(
        Response.json({
          ok: true,
          items: [item],
          list,
          response_metadata: { next_cursor: 'next==' },
        })
      )
    ).output
    expect(output.items[0]).toMatchObject(item)
    expect(output.list).toEqual({ id: 'F123', title: 'Tasks', schema })
    expect(output.nextCursor).toBe('next==')
    expect(
      (
        await slackListsItemsListTool.transformResponse!(
          Response.json({ ok: true, items: [], response_metadata: { next_cursor: '' } })
        )
      ).output
    ).toEqual({ items: [], list: null, nextCursor: '' })
  })
  it('preserves typed response fields and discovers columns on an empty List', async () => {
    const fields = [
      { column_id: 'Col1', key: 'done', value: false, checkbox: [false] },
      { column_id: 'Col2', key: 'score', value: 0, number: [0] },
    ]
    const created = await slackListsItemsCreateTool.transformResponse!(
      Response.json({ ok: true, item: { ...item, fields } })
    )
    expect(created.output.item.fields).toEqual(fields)
    const empty = await slackListsItemsListTool.transformResponse!(
      Response.json({ ok: true, items: [], list, response_metadata: { next_cursor: '' } })
    )
    expect(empty.output.list?.schema).toEqual(schema)
  })
  it('reads items.info from record, and items.create from item', async () => {
    expect(
      (
        await slackListsItemsInfoTool.transformResponse!(
          Response.json({ ok: true, record: item, list, subtasks: [] })
        )
      ).output.item.id
    ).toBe('Rec123')
    expect(
      (await slackListsItemsCreateTool.transformResponse!(Response.json({ ok: true, item }))).output
        .item.id
    ).toBe('Rec123')
    await expect(
      slackListsItemsInfoTool.transformResponse!(Response.json({ ok: true, item, list }))
    ).rejects.toThrow()
  })
  it.each(['missing_scope', 'invalid_auth', 'list_not_found', 'invalid_row_id', 'ratelimited'])(
    'propagates %s for every operation',
    async (error) => {
      for (const tool of tools) {
        await expect(
          tool.transformResponse!(Response.json({ ok: false, error, needed: 'lists:write' }))
        ).rejects.toThrow(error)
      }
    }
  )
  it('includes provider details and reconnect guidance', async () => {
    await expect(
      slackListsItemsUpdateTool.transformResponse!(
        Response.json({
          ok: false,
          error: 'missing_scope',
          needed: 'lists:write',
          detail: 'Permission missing',
        })
      )
    ).rejects.toThrow('lists:write')
    await expect(
      slackListsItemsUpdateTool.transformResponse!(
        Response.json({ ok: false, error: 'missing_scope' })
      )
    ).rejects.toThrow('reconnect')
  })
  it('rejects malformed success payloads instead of masking them as empty rows', async () => {
    await expect(
      slackListsItemsListTool.transformResponse!(Response.json({ ok: true }))
    ).rejects.toThrow()
    await expect(
      slackListsItemsCreateTool.transformResponse!(Response.json({ ok: true }))
    ).rejects.toThrow()
  })
})
