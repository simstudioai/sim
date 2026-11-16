import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { TrelloBlock } from '@/blocks/blocks/trello'

const mapParams = TrelloBlock.tools.config?.params

describe('Trello mapper on agent tool calls', () => {
  it('maps args keyed by the tool param names for the operation in context', () => {
    if (!mapParams) throw new Error('Trello block has no params mapper')

    expect(
      mapParams(
        { oauthCredential: 'cred', name: 'Roadmap', desc: 'Q1 plans', defaultLists: false },
        { operation: 'trello_create_board' }
      )
    ).toMatchObject({ name: 'Roadmap', desc: 'Q1 plans', defaultLists: false })

    expect(
      mapParams(
        { oauthCredential: 'cred', query: 'bug', idBoards: ['b1', 'b2'], cardsLimit: 5 },
        { operation: 'trello_search' }
      )
    ).toMatchObject({ query: 'bug', idBoards: ['b1', 'b2'], cardsLimit: 5 })
  })
})
