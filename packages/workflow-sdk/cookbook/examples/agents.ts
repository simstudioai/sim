// @sim-sdk 1
import {
  agent,
  childWorkflow,
  credential,
  customTool,
  env,
  mcp,
  parallel,
  response,
  router,
  runWorkflow,
  slack,
  t,
  trigger,
  workflow,
} from '@sim/workflow-sdk'

// An example to copy from, not a workflow of yours: `lookup-order`, `linear`, `ops-slack`,
// `enrich-lead` and ANTHROPIC_API_KEY stand in for this workspace's resources
// (.sim/sdk/workspace.d.ts; `sim workflows source resources` lists the real keys).
export default workflow(
  'Cookbook: agents and subflows',
  { description: 'Router, agent tools, a child workflow and a parallel fan-out.' },
  () => {
    const start = trigger.start('Start', {
      inputFormat: { message: 'string', email: 'string', domains: 'array' },
    })

    // Router: the model picks one route by its description; wire with triage.<route>.to(...).
    const triage = router('Triage', {
      context: start.message,
      model: 'claude-sonnet-4-6',
      apiKey: env.ANTHROPIC_API_KEY,
      routes: {
        support: 'A customer asking about an existing order',
        sales: 'A prospect asking about pricing or a demo',
      },
    })

    // Agent tools: a workspace custom tool, one tool of an MCP server, an integration operation
    // (<service>.tool.<operation>; the params given here are fixed, the model fills the rest) and
    // another workflow.
    const support = agent('Support Agent', {
      model: 'claude-sonnet-4-6',
      apiKey: env.ANTHROPIC_API_KEY,
      messages: [
        { role: 'system', content: 'Answer the customer. Use your tools when they help.' },
        { role: 'user', content: start.message },
      ],
      tools: [
        customTool('lookup-order'),
        mcp('linear').tool('create_issue'),
        slack.tool.sendMessage({ credential: credential('ops-slack'), channel: 'support-urgent' }),
        childWorkflow('enrich-lead').asTool(),
      ],
    })

    // Child workflow: inputMapping is checked against the child's start inputs. Its output is
    // enrich.result (untyped JSON): the child's response block output, so a field of the child's
    // response body is enrich.result.data.<field>.
    const enrich = runWorkflow('Enrich Lead', {
      workflowId: childWorkflow('enrich-lead'),
      inputMapping: { email: start.email },
    })

    // Parallel: one branch per item, run at once. p.currentItem is the item and p.index its
    // position; each.results lists every branch's output once all finish. (loop.forEach is the
    // sequential form.) In a function code file inside the body, the same values are
    // $ref.parallel.currentItem and $ref.parallel.index.
    const each = parallel.collection('Each Domain', { collection: start.domains }, (p) => {
      const brief = agent('Company Brief', {
        model: 'claude-sonnet-4-6',
        apiKey: env.ANTHROPIC_API_KEY,
        messages: [{ role: 'user', content: t`Describe ${p.currentItem} in two sentences.` }],
      })
      p.to(brief)
    })

    const answer = response('Answer', { body: { answer: support.content } })
    const briefs = response('Briefs', {
      body: { lead: t`${enrich.result}`, briefs: t`${each.results}` },
    })

    start.to(triage)
    triage.support.to(support)
    support.to(answer)
    triage.sales.to(enrich)
    enrich.to(each)
    each.to(briefs)
  }
)
