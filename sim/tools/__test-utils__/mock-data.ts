/**
 * Mock Data for Tool Tests
 *
 * This file contains mock data samples to be used in tool unit tests.
 */

// HTTP Request Mock Data
export const mockHttpResponses = {
  simple: {
    data: { message: 'Success', status: 'ok' },
    status: 200,
    headers: { 'content-type': 'application/json' },
  },
  error: {
    error: { message: 'Bad Request', code: 400 },
    status: 400,
  },
  notFound: {
    error: { message: 'Not Found', code: 404 },
    status: 404,
  },
  unauthorized: {
    error: { message: 'Unauthorized', code: 401 },
    status: 401,
  },
}

// Gmail Mock Data
export const mockGmailResponses = {
  // List messages response
  messageList: {
    messages: [
      { id: 'msg1', threadId: 'thread1' },
      { id: 'msg2', threadId: 'thread2' },
      { id: 'msg3', threadId: 'thread3' },
    ],
    nextPageToken: 'token123',
  },

  // Empty list response
  emptyList: {
    messages: [],
    resultSizeEstimate: 0,
  },

  // Single message response
  singleMessage: {
    id: 'msg1',
    threadId: 'thread1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'This is a snippet preview of the email...',
    payload: {
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Subject', value: 'Test Email Subject' },
        { name: 'Date', value: 'Mon, 15 Mar 2025 10:30:00 -0800' },
      ],
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from('This is the plain text content of the email').toString('base64'),
          },
        },
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from('<div>This is the HTML content of the email</div>').toString(
              'base64'
            ),
          },
        },
      ],
    },
  },
}

// Google Drive Mock Data
export const mockDriveResponses = {
  // List files response
  fileList: {
    files: [
      { id: 'file1', name: 'Document1.docx', mimeType: 'application/vnd.google-apps.document' },
      {
        id: 'file2',
        name: 'Spreadsheet.xlsx',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
      {
        id: 'file3',
        name: 'Presentation.pptx',
        mimeType: 'application/vnd.google-apps.presentation',
      },
    ],
    nextPageToken: 'drive-page-token',
  },

  // Empty file list
  emptyFileList: {
    files: [],
  },

  // Single file metadata
  fileMetadata: {
    id: 'file1',
    name: 'Document1.docx',
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: 'https://docs.google.com/document/d/123/edit',
    createdTime: '2025-03-15T12:00:00Z',
    modifiedTime: '2025-03-16T10:15:00Z',
    owners: [{ displayName: 'Test User', emailAddress: 'user@example.com' }],
    size: '12345',
  },
}

// Google Sheets Mock Data
export const mockSheetsResponses = {
  // Read range response
  rangeData: {
    range: 'Sheet1!A1:D5',
    majorDimension: 'ROWS',
    values: [
      ['Header1', 'Header2', 'Header3', 'Header4'],
      ['Row1Col1', 'Row1Col2', 'Row1Col3', 'Row1Col4'],
      ['Row2Col1', 'Row2Col2', 'Row2Col3', 'Row2Col4'],
      ['Row3Col1', 'Row3Col2', 'Row3Col3', 'Row3Col4'],
      ['Row4Col1', 'Row4Col2', 'Row4Col3', 'Row4Col4'],
    ],
  },

  // Empty range
  emptyRange: {
    range: 'Sheet1!A1:D5',
    majorDimension: 'ROWS',
    values: [],
  },

  // Update range response
  updateResponse: {
    spreadsheetId: 'spreadsheet123',
    updatedRange: 'Sheet1!A1:D5',
    updatedRows: 5,
    updatedColumns: 4,
    updatedCells: 20,
  },
}

// Pinecone Mock Data
export const mockPineconeResponses = {
  // Vector embedding
  embedding: {
    embedding: Array(1536)
      .fill(0)
      .map(() => Math.random() * 2 - 1),
    metadata: { text: 'Sample text for embedding', id: 'embed-123' },
  },

  // Search results
  searchResults: {
    matches: [
      { id: 'doc1', score: 0.92, metadata: { text: 'Matching text 1' } },
      { id: 'doc2', score: 0.85, metadata: { text: 'Matching text 2' } },
      { id: 'doc3', score: 0.78, metadata: { text: 'Matching text 3' } },
    ],
  },

  // Upsert response
  upsertResponse: {
    upsertedCount: 5,
  },
}

// GitHub Mock Data
export const mockGitHubResponses = {
  // Repository info
  repoInfo: {
    id: 12345,
    name: 'test-repo',
    full_name: 'user/test-repo',
    description: 'A test repository',
    html_url: 'https://github.com/user/test-repo',
    owner: {
      login: 'user',
      id: 54321,
      avatar_url: 'https://avatars.githubusercontent.com/u/54321',
    },
    private: false,
    fork: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-03-15T10:00:00Z',
    pushed_at: '2025-03-15T09:00:00Z',
    default_branch: 'main',
    open_issues_count: 5,
    watchers_count: 10,
    forks_count: 3,
    stargazers_count: 15,
    language: 'TypeScript',
  },

  // PR creation response
  prResponse: {
    id: 12345,
    number: 42,
    title: 'Test PR Title',
    body: 'Test PR description',
    html_url: 'https://github.com/user/test-repo/pull/42',
    state: 'open',
    user: {
      login: 'user',
      id: 54321,
    },
    created_at: '2025-03-15T10:00:00Z',
    updated_at: '2025-03-15T10:05:00Z',
  },
}

// Serper Search Mock Data
export const mockSerperResponses = {
  // Search results
  searchResults: {
    searchParameters: {
      q: 'test query',
      gl: 'us',
      hl: 'en',
    },
    organic: [
      {
        title: 'Test Result 1',
        link: 'https://example.com/1',
        snippet: 'This is a snippet for the first test result.',
        position: 1,
      },
      {
        title: 'Test Result 2',
        link: 'https://example.com/2',
        snippet: 'This is a snippet for the second test result.',
        position: 2,
      },
      {
        title: 'Test Result 3',
        link: 'https://example.com/3',
        snippet: 'This is a snippet for the third test result.',
        position: 3,
      },
    ],
    knowledgeGraph: {
      title: 'Test Knowledge Graph',
      type: 'Test Type',
      description: 'This is a test knowledge graph result',
    },
  },
}

// Slack Mock Data
export const mockSlackResponses = {
  // Message post response
  messageResponse: {
    ok: true,
    channel: 'C1234567890',
    ts: '1627385301.000700',
    message: {
      text: 'This is a test message',
      user: 'U1234567890',
      ts: '1627385301.000700',
      team: 'T1234567890',
    },
  },

  // Error response
  errorResponse: {
    ok: false,
    error: 'channel_not_found',
  },
}

// Tavily Mock Data
export const mockTavilyResponses = {
  // Search results
  searchResults: {
    results: [
      {
        title: 'Test Article 1',
        url: 'https://example.com/article1',
        content: 'This is the content of test article 1.',
        score: 0.95,
      },
      {
        title: 'Test Article 2',
        url: 'https://example.com/article2',
        content: 'This is the content of test article 2.',
        score: 0.87,
      },
      {
        title: 'Test Article 3',
        url: 'https://example.com/article3',
        content: 'This is the content of test article 3.',
        score: 0.72,
      },
    ],
    query: 'test query',
    search_id: 'search-123',
  },
}

// Supabase Mock Data
export const mockSupabaseResponses = {
  // Query response
  queryResponse: {
    data: [
      { id: 1, name: 'Item 1', description: 'Description 1' },
      { id: 2, name: 'Item 2', description: 'Description 2' },
      { id: 3, name: 'Item 3', description: 'Description 3' },
    ],
    error: null,
  },

  // Insert response
  insertResponse: {
    data: [{ id: 4, name: 'Item 4', description: 'Description 4' }],
    error: null,
  },

  // Update response
  updateResponse: {
    data: [{ id: 1, name: 'Updated Item 1', description: 'Updated Description 1' }],
    error: null,
  },

  // Error response
  errorResponse: {
    data: null,
    error: {
      message: 'Database error',
      details: 'Error details',
      hint: 'Error hint',
      code: 'DB_ERROR',
    },
  },
}
