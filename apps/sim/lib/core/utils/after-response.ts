import { after } from 'next/server'

export function afterResponse(task: () => Promise<void>): void {
  after(task)
}
