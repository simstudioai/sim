import { describe, expect, it } from 'vitest'
import {
  buildLockRecordUrl,
  buildSelectRecordsUrl,
  describeAgiloftError,
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

describe('legacy EW* endpoints', () => {
  it('keeps credentials out of the EWSelect URL, which supports a POST body', () => {
    const url = buildSelectRecordsUrl(INSTANCE, { ...baseParams, where: "id='1'" })

    expect(url).toContain('/ewws/EWSelect?')
    expect(url).toContain('&$lang=en')
    expect(url).not.toContain('$login')
    expect(url).not.toContain('$password')
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
})
