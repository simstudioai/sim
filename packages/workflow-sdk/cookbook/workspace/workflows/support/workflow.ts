// @sim-sdk 1
import {
  agent,
  customTool,
  env,
  knowledge,
  knowledgeBase,
  skill,
  t,
  table,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

// workflows/<key>/workflow.ts: a workflow source directory. It names the resources this
// directory declares by key, and one apply creates them before the workflow that uses them.
export default workflow('Support', { description: 'Answers an order question.' }, () => {
  const start = trigger.start('Start', { inputFormat: { orderId: 'string', question: 'string' } })
  const policy = knowledge.search('Policy Search', {
    knowledgeBaseId: knowledgeBase('policies'),
    query: start.question,
    topK: 3,
  })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    // An environment variable by name; its value never appears in source.
    apiKey: env.ANTHROPIC_API_KEY,
    messages: [
      { role: 'system', content: t`Answer from these policies:\n${policy.results}` },
      { role: 'user', content: t`Order ${start.orderId}: ${start.question}` },
    ],
    tools: [customTool('lookup-order')],
    skills: [skill('tone')],
  })
  const log = table.upsertRow('Log Question', {
    tableId: table('orders'),
    data: { orderId: start.orderId, status: 'answered' },
    conflictColumn: 'orderId',
  })

  start.to(policy)
  policy.to(answer)
  answer.to(log)
})
