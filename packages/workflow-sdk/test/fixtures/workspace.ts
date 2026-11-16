import type { WorkspaceManifest } from '../../src/codegen'

/** The workspace the s2 example workflows run in. */
export const FIXTURE_WORKSPACE: WorkspaceManifest = {
  tables: {
    tickets: { columns: { subject: { type: 'string' }, category: { type: 'string' } } },
    leads: {
      columns: {
        email: { type: 'string' },
        status: { type: 'select', options: ['new', 'enriched'] },
        score: { type: 'number' },
      },
    },
  },
  knowledgeBases: ['docs'],
  credentials: {
    'support-slack': { provider: 'slack' },
    'sales-slack': { provider: 'slack' },
    'ops-slack': { provider: 'slack' },
    'finance-gmail': { provider: 'google-email' },
    'finance-google': { provider: 'google-sheets' },
  },
  workflows: { 'assign-owner': { inputs: { leads: 'array' } } },
  env: ['TICKETS_WEBHOOK_TOKEN', 'CRM_KEY'],
}
