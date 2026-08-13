/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  agiloftAlrestBase,
  alrestDeleteRecordUrl,
  alrestRecordUrl,
  alrestSearchUrl,
  buildAttachFileUrl,
  buildCreateRecordBody,
  buildCreateRecordUrl,
  buildLockRecordUrl,
  buildNlpSearchBody,
  buildNlpSearchUrl,
  buildRetrieveAttachmentUrl,
  buildSavedSearchUrl,
  buildSelectRecordsUrl,
  buildUpsertRecordBody,
  describeAgiloftError,
  ewCredentialBody,
  parseFieldList,
  redactAgiloftSecrets,
} from '@/tools/agiloft/utils'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const INSTANCE = 'https://example.agiloft.com'

const baseParams = {
  instanceUrl: INSTANCE,
  knowledgeBase: 'Contract Templates',
  login: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
  table: 'contract',
}

const BASE = agiloftAlrestBase(INSTANCE, baseParams.knowledgeBase)

describe('agiloftAlrestBase', () => {
  it('targets the alrest surface that accepts the EWLogin token', () => {
    expect(BASE).toBe('https://example.agiloft.com/ewws/alrest/Contract%20Templates')
  })

  it('encodes the KB name and tolerates a trailing slash on the instance URL', () => {
    expect(agiloftAlrestBase('https://example.agiloft.com/', 'A B&C')).toBe(
      'https://example.agiloft.com/ewws/alrest/A%20B%26C'
    )
  })
})

describe('alrest record routes', () => {
  it('builds collection, item, and search paths under the KB base', () => {
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
    // Documented parameter name is filePosition, not position.
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
    // Must run under EWLogin/OAuth, so inline credentials are not appended.
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

describe('EWCreate', () => {
  it('carries every parameter in the body, keeping credentials out of the URL', () => {
    const url = buildCreateRecordUrl(INSTANCE)
    const body = buildCreateRecordBody(baseParams, { contract_title1: 'X' })

    expect(url).toBe('https://example.agiloft.com/ewws/EWCreate')
    expect(url).not.toContain(PLACEHOLDER_PASSWORD)

    const sent = new URLSearchParams(body)
    expect(sent.get('$KB')).toBe('Contract Templates')
    expect(sent.get('$table')).toBe('contract')
    expect(sent.get('$login')).toBe('svc.user')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
    expect(sent.get('$lang')).toBe('en')
    expect(sent.get('contract_title1')).toBe('X')
  })

  it('encodes a multi-value field as repeated pairs', () => {
    const sent = new URLSearchParams(
      buildCreateRecordBody(baseParams, { contactMethod: ['phone', 'email'] })
    )
    expect(sent.getAll('contactMethod')).toEqual(['phone', 'email'])
  })

  it('skips null and undefined values rather than writing them as text', () => {
    const sent = new URLSearchParams(
      buildCreateRecordBody(baseParams, { a: null, b: undefined, c: 'kept' })
    )
    expect(sent.has('a')).toBe(false)
    expect(sent.has('b')).toBe(false)
    expect(sent.get('c')).toBe('kept')
  })

  it('refuses an object value rather than writing [object Object] into the record', () => {
    expect(() => buildCreateRecordBody(baseParams, { nested: { a: 1 } })).toThrow(TypeError)
  })

  /**
   * A raw `&` or `=` inside a value would otherwise split the body into extra
   * pairs, writing attacker-chosen fields onto the record.
   */
  it('escapes separators in a value so it cannot open a second field', () => {
    const sent = new URLSearchParams(
      buildCreateRecordBody(baseParams, { note: 'a&$table=other=b' })
    )

    expect(sent.get('note')).toBe('a&$table=other=b')
    expect(sent.get('$table')).toBe('contract')
    expect(sent.getAll('$table')).toHaveLength(1)
  })
})

describe('EWNLPSearch', () => {
  const nlpParams = {
    instanceUrl: INSTANCE,
    knowledgeBase: baseParams.knowledgeBase,
    login: baseParams.login,
    password: PLACEHOLDER_PASSWORD,
    nlpQuery: '  Active NDAs submitted last month  ',
    fields: 'id, contract_title1',
  }

  /**
   * Agiloft reads these as request parameters. Sending them as members of a
   * JSON payload is what makes the endpoint answer "One has to specify $login,
   * $password parameters".
   */
  it('sends the credentials as request parameters, not as payload keys', () => {
    const sent = new URLSearchParams(buildNlpSearchBody(nlpParams))

    expect(buildNlpSearchUrl(INSTANCE)).toBe('https://example.agiloft.com/ewws/EWNLPSearch')
    expect(sent.get('$KB')).toBe('Contract Templates')
    expect(sent.get('$login')).toBe('svc.user')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
    expect(sent.get('$lang')).toBe('en')
  })

  it('trims the query and repeats field once per requested field', () => {
    const sent = new URLSearchParams(buildNlpSearchBody(nlpParams))

    expect(sent.get('nlp_query')).toBe('Active NDAs submitted last month')
    expect(sent.getAll('field')).toEqual(['id', 'contract_title1'])
  })

  /**
   * The contract only requires a non-empty string, so a list of separators
   * reaches here. Sending an empty `field` pair would ask Agiloft for a field
   * with no name.
   */
  it('sends no field pair when the list holds nothing but separators', () => {
    const sent = new URLSearchParams(buildNlpSearchBody({ ...nlpParams, fields: ' , , ' }))

    expect(sent.getAll('field')).toEqual([])
    expect(sent.get('nlp_query')).toBe('Active NDAs submitted last month')
  })

  it('omits pagination when it was not requested', () => {
    const sent = new URLSearchParams(buildNlpSearchBody(nlpParams))
    expect(sent.has('page')).toBe(false)
    expect(sent.has('limit')).toBe(false)
  })

  it('sends pagination when it was requested, since the search spans the whole KB', () => {
    const sent = new URLSearchParams(buildNlpSearchBody({ ...nlpParams, page: '2', limit: '25' }))
    expect(sent.get('page')).toBe('2')
    expect(sent.get('limit')).toBe('25')
  })
})

describe('multi-value field encoding', () => {
  /**
   * An object nested in a multi-value field is as unencodable as a bare one.
   * String()-ing it would write "[object Object]" into the record and report
   * success, which is worse than refusing the call.
   */
  it('refuses an object inside an array rather than writing [object Object]', () => {
    expect(() => buildCreateRecordBody(baseParams, { contactMethod: ['phone', { a: 1 }] })).toThrow(
      TypeError
    )
    expect(() =>
      buildUpsertRecordBody({ ...baseParams, match: 'id' }, { contactMethod: ['phone', { a: 1 }] })
    ).toThrow(TypeError)
  })

  it('keeps encoding scalar array entries after the guard', () => {
    const sent = new URLSearchParams(
      buildCreateRecordBody(baseParams, { contactMethod: ['phone', 42, true] })
    )
    expect(sent.getAll('contactMethod')).toEqual(['phone', '42', 'true'])
  })
})

describe('reserved parameter namespace', () => {
  /**
   * Record data reaches the body builders from workflow input, so a field named
   * after a reserved parameter would append a second occurrence of it and let
   * that data choose the table or the credentials.
   */
  it('refuses a field that reuses a reserved $ parameter name', () => {
    expect(() => buildCreateRecordBody(baseParams, { $table: 'other_table' })).toThrow(TypeError)
    expect(() => buildCreateRecordBody(baseParams, { $password: 'evil' })).toThrow(TypeError)
    expect(() => buildUpsertRecordBody({ ...baseParams, match: 'id' }, { $KB: 'other' })).toThrow(
      TypeError
    )
  })

  it('leaves the reserved pairs single-valued for ordinary field data', () => {
    const sent = new URLSearchParams(buildCreateRecordBody(baseParams, { contract_title1: 'X' }))
    expect(sent.getAll('$table')).toEqual(['contract'])
    expect(sent.getAll('$password')).toEqual([PLACEHOLDER_PASSWORD])
  })
})

describe('pagination input', () => {
  const nlpBase = {
    instanceUrl: INSTANCE,
    knowledgeBase: baseParams.knowledgeBase,
    login: baseParams.login,
    password: PLACEHOLDER_PASSWORD,
    nlpQuery: 'Active NDAs',
    fields: 'id',
  }

  it('drops a non-numeric or negative value rather than widening the search', () => {
    const sent = new URLSearchParams(buildNlpSearchBody({ ...nlpBase, page: 'abc', limit: '-1' }))
    expect(sent.has('page')).toBe(false)
    expect(sent.has('limit')).toBe(false)
  })

  it('keeps a zero page, which is the documented first page', () => {
    const sent = new URLSearchParams(buildNlpSearchBody({ ...nlpBase, page: '0', limit: '10' }))
    expect(sent.get('page')).toBe('0')
    expect(sent.get('limit')).toBe('10')
  })
})

describe('credential redaction', () => {
  const creds = { login: 'svc.user', password: 'p@ss word&1' }

  /**
   * The value goes out form-encoded, so an error page quoting the submitted
   * parameters quotes the encoded spelling, not the raw one.
   */
  it('redacts the encoded spellings the request actually sent', () => {
    const echoed = [
      `raw=${creds.password}`,
      `enc=${encodeURIComponent(creds.password)}`,
      `form=${encodeURIComponent(creds.password).replace(/%20/g, '+')}`,
    ].join(' ')

    const safe = redactAgiloftSecrets(echoed, creds)

    expect(safe).not.toContain(creds.password)
    expect(safe).not.toContain(encodeURIComponent(creds.password))
    expect(safe).not.toContain('p%40ss+word%261')
    expect(safe.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('redacts the login as well as the password', () => {
    expect(redactAgiloftSecrets('user=svc.user', creds)).not.toContain('svc.user')
  })

  it('leaves text carrying no credential untouched', () => {
    expect(redactAgiloftSecrets('EWWrongDataException: no column bogus', creds)).toBe(
      'EWWrongDataException: no column bogus'
    )
  })
})
