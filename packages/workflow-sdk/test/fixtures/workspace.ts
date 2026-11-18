import type { WorkspaceManifest } from '../../src/codegen'

/** The workspace the example workflows run in. */
export const FIXTURE_WORKSPACE: WorkspaceManifest = {
  tables: {
    tickets: { columns: { subject: { type: 'string' }, category: { type: 'string' } } },
    leads: {
      columns: {
        email: { type: 'string', required: true },
        status: { type: 'select', options: ['new', 'enriched'] },
        score: { type: 'number' },
        tags: { type: 'select', options: ['vip', 'churn'], multiple: true },
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
  skills: ['triage', 'tone'],
  customTools: ['lookup-order'],
  env: ['TICKETS_WEBHOOK_TOKEN', 'CRM_KEY'],
}
