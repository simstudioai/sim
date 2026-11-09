import { describe, expect, it } from 'vitest'
import { dollarSkills, withoutHistoryColumn } from './check-guidance-refs'

describe('dollarSkills', () => {
  it('reads a hyphenated $skill reference and leaves query operators alone', () => {
    expect(dollarSkills('Load $sim-paper-design first, then `$add-block`.')).toEqual([
      'sim-paper-design',
      'add-block',
    ])
    expect(dollarSkills('Pass $filter and $select; read $HOME')).toEqual([])
  })
})

describe('withoutHistoryColumn', () => {
  it("blanks a table's Legacy source cells and keeps every other cell and table", () => {
    expect(
      withoutHistoryColumn([
        '| Capability | Legacy source | Status | Proof or reason |',
        '| --- | --- | --- | --- |',
        '| Roles | `apps/sim/gone.tsx` | Done | `apps/sim/kept.test.ts` |',
        '',
        '| Name | Path |',
        '| Roles | `apps/sim/gone.tsx` |',
      ])
    ).toEqual([
      '| Capability | Legacy source | Status | Proof or reason |',
      '| --- | | --- | --- |',
      '| Roles | | Done | `apps/sim/kept.test.ts` |',
      '',
      '| Name | Path |',
      '| Roles | `apps/sim/gone.tsx` |',
    ])
  })
})
