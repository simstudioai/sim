// @sim-sdk 1
import { agent, knowledge, knowledgeBase, response, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Doc QA', () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const search = knowledge.search('Search docs', {
    knowledgeBaseId: knowledgeBase('docs'),
    query: start.question,
    topK: '5',
  })
  const answer = agent('Answer', {
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: t`Answer only from these passages:\n${search.results}` },
      { role: 'user', content: start.question },
    ],
  })
  const reply = response('Reply', { body: { answer: answer.content, question: start.question } })
  start.to(search).to(answer).to(reply)
})
