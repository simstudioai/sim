/**
 * @vitest-environment node
 *
 * Every fixture below is quoted from Agiloft's own REST documentation so the
 * parser is pinned to the published response format rather than to a shape we
 * assumed.
 */
import { describe, expect, it } from 'vitest'
import { parseEwRest, toRecordIds } from '@/lib/internal/agiloft/protocol'

/** REST - Create: "A result similar to the following will be returned". */
const CREATE_BODY = "EWREST_id='353';"

/** REST - Read: the documented result for record 358 of contacts.employees. */
const READ_BODY = `EWREST_full_name='John Doe';
EWREST_first_name='John';
EWREST__1576_company_name0='IBM';
EWREST_f_group_0='Service Manager';
EWREST_id='358';
EWREST__login='jdoe';
EWREST_date_updated='Dec 27 2017 04:40:24';
EWREST_last_name='Doe';`

/** REST - Select, Example 1: three matching records. */
const SELECT_BODY = `EWREST_id_length = '3';
EWREST_id_0 = '150';
EWREST_id_1 = '169';
EWREST_id_2 = '325';`

/** REST - Select: the documented empty result. */
const SELECT_EMPTY_BODY = "EWREST_id_length = '0';"

/** REST - Search, Example 2: two requested fields across four records. */
const SEARCH_BODY = `EWREST_length = '4';
EWREST_summary_0='Here is a new service request with some tasks';
EWREST_priority_0='High';
EWREST_summary_1='New Employee Setup for Patricia Smith';
EWREST_priority_1='High';
EWREST_summary_2='Upgrading Our Software';
EWREST_priority_2='High';
EWREST_summary_3='Need New Wireless Card for Laptop';
EWREST_priority_3='High';`

describe('parseEwRest', () => {
  it('reads the field assignments EWRead returns', () => {
    const values = parseEwRest(READ_BODY)

    expect(values.get('id')).toBe('358')
    expect(values.get('full_name')).toBe('John Doe')
    expect(values.get('date_updated')).toBe('Dec 27 2017 04:40:24')
    expect(values.get('_login')).toBe('jdoe')
  })

  it('tolerates the spaces around = that Select and Search use', () => {
    expect(parseEwRest(SELECT_BODY).get('id_length')).toBe('3')
  })

  it('ignores blank lines and non-assignment noise instead of aborting', () => {
    const values = parseEwRest(`\n${CREATE_BODY}\nnot an assignment\n\n`)

    expect(values.size).toBe(1)
    expect(values.get('id')).toBe('353')
  })
})

describe('toRecordIds', () => {
  it('reads the documented EWSelect result', () => {
    expect(toRecordIds(parseEwRest(SELECT_BODY))).toEqual({
      recordIds: ['150', '169', '325'],
      count: 3,
    })
  })

  it('reads the documented empty EWSelect result', () => {
    expect(toRecordIds(parseEwRest(SELECT_EMPTY_BODY))).toEqual({ recordIds: [], count: 0 })
  })
})
