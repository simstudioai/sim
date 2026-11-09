import type { QuestionItem } from '@/lib/mothership/chat/special-tags'

/**
 * Builds the single user message sent after the final question is answered:
 * one `Prompt — Answer` line per question, for lone questions too. The uniform
 * shape is what lets the chat pair this message back to its question card
 * (see parseQuestionAnswerMessage) and render the card as the user turn
 * instead of echoing a duplicate bubble.
 */
export function formatQuestionAnswerMessage(questions: QuestionItem[], answers: string[]): string {
  return questions.map((q, i) => `${q.prompt} — ${answers[i] ?? ''}`).join('\n')
}

/**
 * Strictly matches a user message against a question batch's answer format:
 * exactly one `Prompt — Answer` line per question, in order. Returns the
 * answers, or null when the message is not this batch's answer — a dismissed
 * card followed by an unrelated typed message must not match.
 */
export function parseQuestionAnswerMessage(
  questions: QuestionItem[],
  content: string
): string[] | null {
  const lines = content.split('\n')
  if (lines.length !== questions.length) return null
  const answers: string[] = []
  for (const [i, question] of questions.entries()) {
    const prefix = `${question.prompt} — `
    if (!lines[i].startsWith(prefix)) return null
    answers.push(lines[i].slice(prefix.length))
  }
  return answers
}
