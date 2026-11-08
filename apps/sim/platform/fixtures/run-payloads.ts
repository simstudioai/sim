import 'server-only'

/** What a run's example payloads are drawn from, so each run's data reads as its own. */
interface RunPayloadContext {
  runId: string
  workflow: string
  trigger: string
  startedAt: number
  totalMs: number
  failed: boolean
}

const REQUEST =
  'My laptop will not join the office Wi-Fi since this morning. I tried restarting twice and it still says “Unable to join network ACME-Corp”.'

const SYSTEM_PROMPT =
  'You triage IT service desk requests for Acme. Classify each request into exactly one category, estimate its urgency from the requester’s words and the affected systems, and call a tool only when the knowledge base or a system of record can settle a fact. Reply with JSON that matches the response schema. Never guess an asset tag, and never promise a time to resolution.'

const ARTICLES = [
  {
    id: 'kb_0412',
    title: 'Reinstall the office Wi-Fi certificate',
    url: 'https://help.acme.example/kb/networking/reinstall-the-office-wifi-certificate?ref=agent&source=search_knowledge',
    score: 0.947,
    updatedAt: '2026-09-28T08:12:44Z',
    author: { id: 'U01MKRAUS', name: 'Mara Krauss', team: 'Network engineering' },
    snippet:
      'When a laptop shows “Unable to join network ACME-Corp” after the certificate rotation on September 27, remove the expired certificate from the keychain and request a new one from the device portal.',
    highlights: ['Unable to join network', 'certificate rotation', 'device portal'],
  },
  {
    id: 'kb_0388',
    title: 'Office network list by site',
    url: 'https://help.acme.example/kb/networking/office-network-list',
    score: 0.812,
    updatedAt: '2026-07-02T15:40:01Z',
    author: { id: 'U03OKAFO', name: 'Ada Okafor', team: 'Workplace' },
    snippet:
      'Berlin, Munich and Vienna use ACME-Corp for managed devices and ACME-Guest for visitors.',
    highlights: ['ACME-Corp', 'managed devices'],
  },
  {
    id: 'kb_0207',
    title: 'Laptops that cannot reach the VPN or office network',
    url: 'https://help.acme.example/kb/networking/vpn-and-office-network-troubleshooting',
    score: 0.774,
    updatedAt: '2026-05-19T11:03:27Z',
    author: { id: 'U01MKRAUS', name: 'Mara Krauss', team: 'Network engineering' },
    snippet:
      'Check the device is enrolled, the clock is in sync and the network profile is installed before escalating to network engineering.',
    highlights: ['enrolled', 'network profile'],
  },
]

/** The request that started the run, as the trigger delivered it. */
function triggerEvent({ runId, trigger, startedAt }: RunPayloadContext) {
  return {
    trigger: {
      type: trigger.toLowerCase(),
      deliveryId: `Ev${runId.slice(0, 10).toUpperCase()}`,
      receivedAt: new Date(startedAt).toISOString(),
      attempt: 1,
    },
    event: {
      type: 'message',
      channel: { id: 'C04ITHELP2', name: 'it-help', isPrivate: false, isShared: false },
      user: {
        id: 'U02LVOGT9',
        name: 'Lena Vogt',
        email: 'lena.vogt@acme.example',
        title: 'Regional owner, EMEA',
        timezone: 'Europe/Berlin',
        locale: 'de-DE',
      },
      text: REQUEST,
      ts: `${Math.floor(startedAt / 1000)}.381259`,
      threadTs: null,
      files: [
        {
          id: 'F07Q2M9KX4',
          name: 'wifi-error.png',
          mimetype: 'image/png',
          size: 284_113,
          url: 'https://files.acme.example/slack/T01ACME/F07Q2M9KX4/wifi-error.png?token=redacted',
        },
      ],
      blocks: [
        {
          type: 'rich_text',
          elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: REQUEST }] }],
        },
      ],
    },
    workspace: { id: 'it', name: 'IT service desk', region: 'eu-central-1' },
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Slackbot 1.0 (+https://api.slack.com/robots)',
      'x-slack-request-timestamp': String(Math.floor(startedAt / 1000)),
      'x-slack-signature': 'v0=redacted',
    },
  }
}

/** What the run settled, with the ticket it closed and who it told. */
function runResult({ runId, workflow, totalMs }: RunPayloadContext) {
  return {
    resolved: true,
    ticket: {
      id: 'INC-20418',
      status: 'resolved',
      priority: 'P3',
      category: 'hardware',
      assignee: null,
      url: 'https://acme.service-desk.example/incidents/INC-20418',
    },
    steps: [
      { step: 'Classify request', result: 'hardware', confidence: 0.91 },
      { step: 'Enrich requester', result: 'Acme GmbH, Enterprise, 3 groups' },
      { step: 'Check each device', result: '3 devices, 1 from cache' },
      { step: 'Access request approval', result: 'approved by regional owner' },
    ],
    notifications: [
      { channel: 'slack', to: 'U02LVOGT9', delivered: true, messageTs: '1792054487.002100' },
      { channel: 'email', to: 'lena.vogt@acme.example', delivered: false, reason: 'digest only' },
    ],
    timings: { queuedMs: 412, totalMs, slowestStep: 'Access request approval' },
    metadata: { runId, workflow, version: 'v14', retries: 1, tags: ['wifi', 'hardware', 'emea'] },
  }
}

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  required: ['category', 'urgency', 'confidence'],
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['hardware', 'network', 'access', 'software', 'other'] },
    urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string', maxLength: 600 },
  },
}

const SEARCH_TOOL = {
  type: 'function',
  name: 'search_knowledge',
  description: 'Search the IT knowledge base and return the best matching articles.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Plain words, no operators.' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
      filters: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          updatedAfter: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}

/** The agent's own request and decision. */
function classifyInput() {
  return {
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content: REQUEST, attachments: ['wifi-error.png'] }],
    tools: [SEARCH_TOOL],
    responseSchema: CLASSIFICATION_SCHEMA,
    memory: {
      requesterHistory: { openTickets: 0, lastTicket: 'INC-19811', lastCategory: 'access' },
    },
  }
}

function classifyOutput() {
  return {
    category: 'hardware',
    urgency: 'normal',
    confidence: 0.91,
    reasoning:
      'The requester reports a managed laptop that cannot join the corporate network after the certificate rotation; the knowledge base article kb_0412 describes the same symptom, and no outage is open for the Berlin office.',
    scores: { hardware: 0.91, network: 0.06, access: 0.02, software: 0.01, other: 0 },
    entities: [
      { type: 'network', value: 'ACME-Corp', start: 96, end: 105 },
      { type: 'site', value: 'Berlin office', inferredFrom: 'user.timezone' },
    ],
    citations: ['kb_0412'],
  }
}

/** The model call as sent and as answered, with the tool call it asked for. */
function modelRequest() {
  return {
    model: 'gpt-5',
    temperature: 0.2,
    max_output_tokens: 1024,
    store: false,
    text: {
      format: { type: 'json_schema', name: 'classification', schema: CLASSIFICATION_SCHEMA },
    },
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'input_text', text: REQUEST }] },
    ],
    tools: [SEARCH_TOOL],
    tool_choice: 'auto',
  }
}

function modelResponse() {
  return {
    id: 'resp_0c51f7e2a9d84b16',
    object: 'response',
    model: 'gpt-5-2026-08-07',
    status: 'completed',
    output: [
      {
        type: 'function_call',
        id: 'fc_6d1e',
        call_id: 'call_8f2c41d07a',
        name: 'search_knowledge',
        arguments: JSON.stringify({ query: 'laptop office wifi certificate', limit: 3 }),
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(classifyOutput()) }],
      },
    ],
    usage: {
      input_tokens: 1204,
      input_tokens_details: { cached_tokens: 896 },
      output_tokens: 318,
      output_tokens_details: { reasoning_tokens: 192 },
      total_tokens: 1522,
    },
  }
}

function searchInput() {
  return {
    query: 'laptop office wifi certificate',
    limit: 3,
    filters: { site: 'Berlin', updatedAfter: '2026-01-01T00:00:00Z' },
  }
}

function searchOutput() {
  return { total: 14, tookMs: 38, results: ARTICLES }
}

/** The CRM account behind the requester, with the empty and nested fields a real record carries. */
function accountRecord() {
  return {
    Id: '0015g00000QxT3vAAF',
    Name: 'Acme GmbH',
    Type: 'Customer - Direct',
    Tier__c: 'Enterprise',
    Industry: 'Manufacturing',
    AnnualRevenue: 184_000_000,
    NumberOfEmployees: 2140,
    IsPartner: false,
    ParentId: null,
    Owner: { Id: '0055g00000A1bCdAAB', Name: 'Lena Vogt', Email: 'lena.vogt@acme.example' },
    BillingAddress: {
      street: 'Friedrichstraße 68',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      countryCode: 'DE',
    },
    Contacts: {
      totalSize: 2,
      done: true,
      records: [
        {
          Id: '0035g00000Zq1AAAQ',
          Name: 'Jonas Becker',
          Title: 'IT lead',
          Phone: '+49 30 1234 5678',
        },
        { Id: '0035g00000Zq1BAAQ', Name: 'Sofía Álvarez', Title: 'Office manager', Phone: null },
      ],
    },
    Entitlements__r: [
      { Name: 'Premier support', StartDate: '2026-01-01', EndDate: '2026-12-31', Active: true },
      {
        Name: 'On-site hardware swap',
        StartDate: '2025-04-01',
        EndDate: '2026-03-31',
        Active: false,
      },
    ],
    attributes: {
      type: 'Account',
      url: '/services/data/v62.0/sobjects/Account/0015g00000QxT3vAAF',
    },
  }
}

function directoryGroups() {
  return {
    user: { id: '00u1lvogt9AcmeEU', login: 'lena.vogt@acme.example', status: 'ACTIVE' },
    groups: [
      {
        id: '00g1berlin',
        profile: { name: 'berlin-office', description: 'Badge and Wi-Fi access for Berlin' },
      },
      {
        id: '00g1eng',
        profile: { name: 'engineering', description: 'Source control and build systems' },
      },
      { id: '00g1vpn', profile: { name: 'vpn-users', description: 'Remote network access' } },
    ],
    _links: {
      next: null,
      self: 'https://acme.okta.example/api/v1/users/00u1lvogt9AcmeEU/groups?limit=200',
    },
  }
}

/** One managed device from the inventory, with its compliance checks. */
function deviceRecord(index: number) {
  return {
    serial: `C02X${index}LK8`,
    assetTag: `ACME-LT-${4410 + index}`,
    model: 'MacBook Pro (14-inch, 2025)',
    managed: true,
    owner: 'lena.vogt@acme.example',
    lastCheckIn: '2026-10-13T07:58:12Z',
    os: { name: 'macOS', version: '16.1', build: '25B74' },
    network: {
      wifiProfile: 'ACME-Corp',
      certificate: {
        subject: 'CN=C02X0LK8.acme.example',
        expires: '2026-09-27T00:00:00Z',
        valid: false,
      },
      lastSsid: 'ACME-Guest',
    },
    compliance: [
      { check: 'disk_encryption', status: 'pass' },
      { check: 'os_up_to_date', status: 'pass' },
      { check: 'wifi_certificate', status: 'fail', detail: 'expired on 2026-09-27' },
    ],
    source: index === 1 ? 'cache' : 'inventory',
  }
}

function policyRules() {
  return {
    policy: 'Network access',
    version: 7,
    approver: 'regional-owner',
    rules: [
      {
        id: 'na-1',
        when: { group: 'berlin-office', resource: 'ACME-Corp' },
        then: { approve: 'automatic' },
      },
      {
        id: 'na-2',
        when: { resource: 'ACME-Corp', deviceManaged: false },
        then: { approve: 'regional-owner', escalateAfterHours: 4 },
      },
      { id: 'na-3', when: { incident: true }, then: { approve: 'incident-commander' } },
    ],
    exceptions: [],
  }
}

/** The approval model call, in content blocks. */
function approvalRequest() {
  return {
    model: 'claude-sonnet-5-5',
    max_tokens: 2048,
    system:
      'Draft a short approval request for the regional owner. Quote the policy rule you relied on.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Requester: Lena Vogt (berlin-office, engineering, vpn-users).' },
          { type: 'text', text: 'Device: ACME-LT-4410, Wi-Fi certificate expired on 2026-09-27.' },
        ],
      },
    ],
  }
}

function approvalResponse() {
  return {
    id: 'msg_01HV8Z3K2Q9N7XJ4',
    type: 'message',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: 'Lena Vogt needs a new Wi-Fi certificate for ACME-LT-4410. Rule na-1 approves berlin-office members automatically, so no action is needed unless you object within four working hours.',
      },
    ],
    usage: { input_tokens: 862, output_tokens: 74, cache_read_input_tokens: 0 },
  }
}

function summaryInput({ runId, failed }: RunPayloadContext) {
  return {
    ticket: 'INC-20418',
    runId,
    steps: 4,
    outcome: failed ? 'unknown' : 'resolved',
    context: {
      classification: classifyOutput(),
      account: { name: 'Acme GmbH', tier: 'Enterprise' },
      devices: [0, 1, 2].map((index) => ({
        assetTag: `ACME-LT-${4410 + index}`,
        compliant: index !== 0,
      })),
    },
  }
}

/** Every example payload a run's trace shows, keyed by the step that read or wrote it. */
export function runPayloads(context: RunPayloadContext) {
  return {
    trigger: triggerEvent(context),
    result: runResult(context),
    classifyInput: classifyInput(),
    classifyOutput: classifyOutput(),
    modelRequest: modelRequest(),
    modelResponse: modelResponse(),
    searchInput: searchInput(),
    searchOutput: searchOutput(),
    account: accountRecord(),
    groups: directoryGroups(),
    device: deviceRecord,
    policy: policyRules(),
    approvalRequest: approvalRequest(),
    approvalResponse: approvalResponse(),
    summaryInput: summaryInput(context),
  }
}
