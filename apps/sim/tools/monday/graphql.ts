import { createLogger } from '@sim/logger'

const logger = createLogger('MondayGraphQL')

/**
 * GraphQL request structure
 */
export interface GraphQLRequest {
  query: string
  variables?: Record<string, any>
}

/**
 * Execute a GraphQL query against the Monday.com API
 */
export async function executeMondayQuery<T>(
  apiKey: string,
  request: GraphQLRequest
): Promise<T> {
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
      'API-Version': '2024-01',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Monday.com API error', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Monday.com API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()

  if (data.errors) {
    logger.error('Monday.com GraphQL errors', { errors: data.errors })
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`)
  }

  return data.data as T
}

/**
 * Common GraphQL queries for Monday.com
 */
export const QUERIES = {
  GET_BOARDS: `
    query {
      boards {
        id
        name
        description
        board_kind
        state
      }
    }
  `,

  GET_BOARD_COLUMNS: `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  `,

  GET_BOARD_GROUPS: `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        groups {
          id
          title
          color
        }
      }
    }
  `,

  CREATE_ITEM: `
    mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $itemName
        column_values: $columnValues
      ) {
        id
        name
        created_at
        board { id }
        group { id }
        column_values {
          id
          type
          text
          value
        }
      }
    }
  `,

  UPDATE_ITEM: `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId
        item_id: $itemId
        column_values: $columnValues
      ) {
        id
        name
        updated_at
        column_values {
          id
          type
          text
          value
        }
      }
    }
  `,

  GET_ITEM: `
    query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        created_at
        updated_at
        board { id }
        group { id }
        column_values {
          id
          type
          text
          value
        }
      }
    }
  `,

  LIST_ITEMS: `
    query ($boardId: [ID!]!, $limit: Int) {
      boards(ids: $boardId) {
        items_page(limit: $limit) {
          items {
            id
            name
            created_at
            updated_at
            board { id }
            group { id }
            column_values {
              id
              type
              text
              value
            }
          }
        }
      }
    }
  `,

  GET_COLUMN_SETTINGS: `
    query ($boardId: [ID!]!, $columnId: String!) {
      boards(ids: $boardId) {
        columns(ids: [$columnId]) {
          id
          title
          type
          settings_str
        }
      }
    }
  `,

  GET_BOARD_ITEMS: `
    query ($boardId: [ID!]!, $limit: Int) {
      boards(ids: $boardId) {
        items_page(limit: $limit) {
          items {
            id
            name
          }
        }
      }
    }
  `,

  GET_ITEM_SUBITEMS: `
    query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        subitems {
          id
          name
        }
      }
    }
  `,
}
