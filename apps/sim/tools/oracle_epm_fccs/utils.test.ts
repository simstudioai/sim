/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))

import { mapFccsBlockParams } from '@/blocks/blocks/oracle_epm_fccs'
import { coerceFccsBoolean, coerceFccsJson, coerceFccsNumber } from '@/tools/oracle_epm_fccs/utils'

describe('FCCS resolved block input mapping', () => {
  it('coerces numbers/booleans/JSON only after values are resolved', () => {
    expect(coerceFccsNumber('25')).toBe(25)
    expect(coerceFccsBoolean('false')).toBe(false)
    expect(coerceFccsJson('{"RTP.Entity":"North"}')).toEqual({ 'RTP.Entity': 'North' })
    for (const coerce of [coerceFccsNumber, coerceFccsBoolean, coerceFccsJson])
      expect(coerce('<previous.output>')).toBe('<previous.output>')
    expect(coerceFccsNumber('oops')).toBe('oops')
    expect(coerceFccsJson('{oops')).toBe('{oops')
  })
  it('passes only active fields and never caller credential material', () => {
    expect(
      mapFccsBlockParams({
        operation: 'oracle_epm_fccs_list_dimensions',
        oauthCredential: 'chosen',
        accessToken: 'untrusted',
        instanceUrl: 'https://untrusted',
        application: 'Close',
        cube: 'Consol',
        offset: '0',
        limit: '25',
        filter: '{"dimType":"Entity"}',
        profileName: 'stale',
      })
    ).toEqual({
      oauthCredential: 'chosen',
      application: 'Close',
      cube: 'Consol',
      offset: 0,
      limit: 25,
      filter: { dimType: 'Entity' },
    })
  })
  it('maps new-member/parent canonical fields without trimming names', () => {
    expect(
      mapFccsBlockParams({
        operation: 'oracle_epm_fccs_add_member',
        oauthCredential: 'chosen',
        application: 'Close',
        dimension: 'Entity',
        newMemberName: ' New %20 ',
        parentMember: 'Parent',
        member: 'stale',
      })
    ).toEqual({
      oauthCredential: 'chosen',
      application: 'Close',
      dimension: 'Entity',
      member: ' New %20 ',
      parentName: 'Parent',
    })
  })
  it('maps manual jobs separately from configured jobs and clears stale repository filenames', () => {
    expect(
      mapFccsBlockParams({
        operation: 'oracle_epm_fccs_import_journals',
        application: 'Close',
        manualJobName: 'Journal Import',
        repositoryFile: 'inbox/a.jlf',
        fileName: 'stale',
      })
    ).toMatchObject({ jobName: 'Journal Import', fileName: 'inbox/a.jlf' })
    expect(
      mapFccsBlockParams({
        operation: 'oracle_epm_fccs_export_metadata',
        application: 'Close',
        jobName: 'Metadata',
        parameters: '{"exportZipFileName":"out.zip"}',
        manualJobName: 'stale',
      })
    ).toMatchObject({ jobName: 'Metadata', parameters: { exportZipFileName: 'out.zip' } })
  })
  it('maps a single stored file and preserves destination filename separately', () => {
    const file = {
      id: 'f',
      name: 'source.csv',
      url: '/api/files/x',
      size: 3,
      type: 'text/csv',
      key: 'workspace/key',
      context: 'workspace',
    }
    expect(
      mapFccsBlockParams({
        operation: 'oracle_epm_fccs_upload_file',
        file: [file],
        fileName: 'destination %20.csv',
        directory: 'inbox',
      })
    ).toMatchObject({ file, fileName: 'destination %20.csv', directory: 'inbox' })
  })
})
