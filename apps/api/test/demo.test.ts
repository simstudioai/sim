// test/index.test.ts
import { describe, expect, it } from 'bun:test'
import { edenTreaty } from '@elysiajs/eden'
import Elysia from 'elysia'

const app = new Elysia()
    .get('/', () => 'hi')
    .listen(3000)

const api = edenTreaty<typeof app>('http://localhost:3000')

describe('Elysia', () => {
    it('return a response', async () => {
        const { data } = await api.get()
        expect(data).toBe('hi')
    })
})