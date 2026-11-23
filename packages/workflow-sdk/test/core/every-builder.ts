// @sim-sdk 1
import {
  agent,
  block,
  childWorkflow,
  codeFile,
  condition,
  credential,
  customTool,
  edge,
  env,
  file,
  fn,
  folder,
  human,
  js,
  json,
  knowledge,
  knowledgeBase,
  loop,
  mcp,
  md,
  note,
  parallel,
  py,
  raw,
  ref,
  response,
  router,
  runWorkflow,
  setVariables,
  sh,
  skill,
  slack,
  stored,
  t,
  table,
  todo,
  trigger,
  vars,
  workflow,
} from '@sim/workflow-sdk'

export default workflow(
  'Every builder',
  {
    description: 'Uses every core.d.ts builder once',
    variables: { count: { type: 'number', value: 0 } },
  },
  ({ vars: declared }) => {
    const start = trigger.start('Start', { inputFormat: { question: 'string', items: 'array' } })
    const answer = agent('Answer', {
      model: 'claude-sonnet-5-5',
      apiKey: stored(),
      messages: [{ role: 'user', content: t`${start.question} (${declared.count})` }],
      responseFormat: json`{"type":"object"}`,
      tools: [
        slack.tool.sendMessage({
          credential: credential('ops-slack'),
          channel: 'C0OPS',
          text: 'hi',
        }),
        customTool('lookup-order', { usageControl: 'auto' }),
        mcp('docs').tool('search_docs', {
          args: { limit: '5' },
          usageControl: 'force',
          snapshot: { serverName: 'Docs', schema: { type: 'object' } },
        }),
        childWorkflow('assign-owner').asTool({ usageControl: 'auto' }),
      ],
    })
    const search = knowledge.search('Search', {
      knowledgeBaseId: knowledgeBase('docs'),
      query: start.question,
    })
    const rows = table.queryRows('Rows', { tableId: table('leads') })
    const inline = fn('Inline', { code: js`return ${ref('answer.content')}` })
    const python = fn('Python', {
      language: 'python',
      code: py`print(${inline.result.any.depth.path})`,
    })
    const fromFile = fn('From file', { code: codeFile('./functions/score.js') })
    const gate = condition('Gate', { yes: js`${rows.totalCount} > 0`, else: true })
    const route = router('Route', {
      context: start.question,
      model: 'claude-sonnet-5-5',
      routes: { fast: 'Short questions', slow: 'Everything else' },
    })
    const counted = loop.for('Counted', { count: 3 }, (scope) => {
      const tick = fn('Tick', { code: js`return ${scope.index}` })
      scope.to(tick)
    })
    const each = loop.forEach('Each', { collection: start.items }, (scope) => {
      const item = fn('Item', { code: js`return ${scope.currentItem}` })
      scope.to(item)
    })
    const whileLoop = loop.while('While', { condition: js`${vars.count} < 3` }, (scope) => {
      const spin = fn('Spin', { code: js`return 1` })
      scope.to(spin)
    })
    const doWhile = loop.doWhile('Do while', { condition: js`false` }, (scope) => {
      const once = fn('Once', { code: js`return 1` })
      scope.to(once)
    })
    const fanOut = parallel('Fan out', { count: 2 }, (scope) => {
      const branch = fn('Branch', { code: js`return 1` })
      scope.to(branch)
    })
    const byCount = parallel.count('By count', { count: 2 }, (scope) => {
      const countedBranch = fn('Counted branch', { code: js`return 1` })
      scope.to(countedBranch)
    })
    const byItem = parallel.collection('By item', { collection: start.items }, (scope) => {
      const itemBranch = fn('Item branch', { code: js`return ${scope.currentItem}` })
      scope.to(itemBranch)
    })
    const child = runWorkflow('Child', {
      workflowId: childWorkflow('assign-owner'),
      inputMapping: { leads: start.items },
    })
    const approval = human('Approval', { inputFormat: { approved: 'boolean' } })
    const assign = setVariables('Assign', {
      variables: [{ variableId: declared.count, value: 1 }],
    })
    const opaque = block('retired_block', 'Retired', {
      skill: skill('triage'),
      folder: folder('reports'),
      document: file('contracts/acme.pdf'),
      later: todo(),
      legacy: raw('kept-verbatim'),
      script: sh`echo ${env.CRM_KEY}`,
    })
    const done = response('Done', { body: { answer: answer.content }, status: 200 })
    const built = response('Built', { dataMode: 'structured' })
    const failed = response('Child Failed', { body: { why: rows.error }, status: 502 })
    note('Readme', { content: md`# Every builder` })

    start.to(answer).to(search).to(rows).to(gate)
    gate.yes.to(inline).to(python).to(fromFile).to(route)
    gate.else.to(counted)
    route.fast.to(each).to(whileLoop).to(doWhile)
    route.slow.to(fanOut).to(byCount).to(byItem).to(child).to(approval).to(assign)
    assign.to(opaque).to(done)
    edge(opaque, 'legacy-port', built)
    child.onError(built)
    rows.onError(failed)
  }
)
