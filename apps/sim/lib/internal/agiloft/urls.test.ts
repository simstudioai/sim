/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  agiloftAlrestBase,
  alrestDeleteRecordUrl,
  alrestRecordCollectionUrl,
  alrestRecordUrl,
  alrestSearchUrl,
  buildAttachFileUrl,
  buildLockRecordUrl,
  buildRetrieveAttachmentUrl,
  buildSavedSearchUrl,
  buildSelectRecordsUrl,
  describeAgiloftError,
  ewCredentialBody,
  parseFieldList,
} from '@/lib/internal/agiloft/urls'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const INSTANCE = 'https://example.agiloft.com'

const baseParams = {
  instanceUrl: INSTANCE,
  knowledgeBase: 'Russell Investments',
  login: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
  table: 'contract',
}

const BASE = agiloftAlrestBase(INSTANCE, baseParams.knowledgeBase)

describe('agiloftAlrestBase', () => {
  it('targets the alrest surface that accepts the EWLogin token', () => {
    expect(BASE).toBe('https://example.agiloft.com/ewws/alrest/Russell%20Investments')
  })

  it('encodes the KB name and tolerates a trailing slash on the instance URL', () => {
    expect(agiloftAlrestBase('https://example.agiloft.com/', 'A B&C')).toBe(
      'https://example.agiloft.com/ewws/alrest/A%20B%26C'
    )
  })
})

describe('alrest record routes', () => {
  it('builds collection, item, and search paths under the KB base', () => {
    expect(alrestRecordCollectionUrl(BASE, 'contract')).toBe(`${BASE}/contract?lang=en`)
    expect(alrestRecordUrl(BASE, 'contract', ' 6342 ')).toBe(`${BASE}/contract/6342?lang=en`)
    expect(alrestSearchUrl(BASE, 'contract')).toBe(`${BASE}/contract/search?lang=en`)
  })

  it('retrieves attachments through the documented EWRetrieve endpoint', () => {
    const url = buildRetrieveAttachmentUrl(INSTANCE, {
      ...baseParams,
      recordId: '1234',
      fieldName: 'someField',
      position: '1',
    })

    expect(url).toContain('/ewws/EWRetrieve?')
    expect(url).toContain('&id=1234')
    expect(url).toContain('&field=someField')
    /** Documented parameter name is filePosition, not position. */
    expect(url).toContain('&filePosition=1')
  })

  it('always carries a delete rule so linked-record behavior is explicit', () => {
    expect(alrestDeleteRecordUrl(BASE, 'contract', '6342', 'ERROR_IF_DEPENDANTS')).toBe(
      `${BASE}/contract/6342?lang=en&deleteRule=ERROR_IF_DEPENDANTS`
    )
  })
})

describe('parseFieldList', () => {
  it('splits and trims a comma-separated projection', () => {
    expect(parseFieldList(' id , contract_title1 ,, ')).toEqual(['id', 'contract_title1'])
  })

  it('returns undefined when nothing usable was given, so no projection is sent', () => {
    expect(parseFieldList(undefined)).toBeUndefined()
    expect(parseFieldList('   ')).toBeUndefined()
    expect(parseFieldList(',,')).toBeUndefined()
  })
})

describe('legacy EW* endpoints', () => {
  it('keeps credentials out of the EWSelect URL, which supports a POST body', () => {
    const url = buildSelectRecordsUrl(INSTANCE, { ...baseParams, where: "id='1'" })

    expect(url).toContain('/ewws/EWSelect?')
    expect(url).toContain('&$lang=en')
    expect(url).not.toContain('$login')
    expect(url).not.toContain('$password')
  })

  it('form-encodes credentials for the operations that accept a body', () => {
    const body = ewCredentialBody(baseParams)

    const sent = new URLSearchParams(body)
    expect(sent.get('$login')).toBe('svc.user')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
  })

  it('percent-encodes credentials in the URL for operations with no body option', () => {
    const url = buildLockRecordUrl(INSTANCE, {
      ...baseParams,
      login: 'a&b=c',
      password: 'placeholder&pass=word',
      recordId: '18',
      lockAction: 'check',
    })

    expect(url).toContain('&$login=a%26b%3Dc')
    expect(url).toContain('&$password=placeholder%26pass%3Dword')
  })

  it('adds force only when unlocking', () => {
    expect(
      buildLockRecordUrl(INSTANCE, {
        ...baseParams,
        recordId: '18',
        lockAction: 'unlock',
        force: true,
      })
    ).toContain('&force=true')

    expect(
      buildLockRecordUrl(INSTANCE, {
        ...baseParams,
        recordId: '18',
        lockAction: 'lock',
        force: true,
      })
    ).not.toContain('force=true')
  })
})

describe('documented response keys', () => {
  it('builds the EWSavedSearch URL with the mandatory .json decorator and no credentials', () => {
    const url = buildSavedSearchUrl(INSTANCE, baseParams)

    expect(url).toContain('/ewws/EWSavedSearch/.json?')
    expect(url).toContain('$table=contract')
    /** Must run under EWLogin/OAuth, so inline credentials are not appended. */
    expect(url).not.toContain('$login')
    expect(url).not.toContain('$password')
  })
})

describe('describeAgiloftError', () => {
  it('reduces the HTML-wrapped exception to its message', () => {
    const body =
      '<html><head><title>Error</title></head><body>EWWrongDataException has occurred: ' +
      '[default task-70331][1786479740423] One has to specify $table, $KB, $lang parameters' +
      '</body></html>'

    expect(describeAgiloftError(body)).toBe(
      'EWWrongDataException: One has to specify $table, $KB, $lang parameters'
    )
  })

  it('passes through a body that is not a typed exception', () => {
    expect(describeAgiloftError('Error executing query, please consult logs')).toBe(
      'Error executing query, please consult logs'
    )
  })
})

describe('documented optional parameters', () => {
  it('adds subs only for the delete rule that reads it', () => {
    const withReplace = alrestDeleteRecordUrl(
      BASE,
      'contract',
      '6342',
      'REPLACE_WITH_ANOTHER',
      '7,8'
    )
    expect(withReplace).toContain('&subs=7')
    expect(withReplace).toContain('&subs=8')

    const withoutReplace = alrestDeleteRecordUrl(BASE, 'contract', '6342', 'APPLY_UNLINK', '7,8')
    expect(withoutReplace).not.toContain('subs')
  })

  it('asks the JSON decorator for real status codes', () => {
    expect(buildSavedSearchUrl(INSTANCE, baseParams)).toContain('err_code_resp=1')
  })
})

describe('attach overwrite', () => {
  it('sends the documented fieldName$overwrite marker only when requested', () => {
    const on = buildAttachFileUrl(
      INSTANCE,
      { ...baseParams, recordId: '1', fieldName: 'docs', overwrite: true },
      'a.pdf'
    )
    expect(on).toContain('docs%24overwrite=true')

    const off = buildAttachFileUrl(
      INSTANCE,
      { ...baseParams, recordId: '1', fieldName: 'docs' },
      'a.pdf'
    )
    expect(off).not.toContain('overwrite')
  })
})
