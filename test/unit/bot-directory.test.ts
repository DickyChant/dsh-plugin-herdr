import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { registerBotDirectory } from '../../src/bot-directory.ts'

test('directory route guards methods and origins and never includes service errors', async () => {
  let route: any
  let calls = 0
  let fail = false
  const ctx: any = {
    webServer: { register(value: unknown) { route = value; return () => {} } },
    botDirectory: { async snapshot() { calls++; if (fail) throw new Error('PRIVATE'); return { version: 1, bots: [] } } },
    inject(_keys: string[], callback: (ctx: unknown) => void) { callback(ctx) },
    effect(callback: () => unknown) { callback() },
  }
  registerBotDirectory(ctx as Context)
  assert.equal(route.path, '/herdr-bots')
  const request = async (method: string, headers: Record<string, string>) => {
    let status = 0
    let body = ''
    await route.handler({ method, headers }, { writeHead(code: number) { status = code }, end(value: string) { body = value } })
    return { status, body }
  }
  assert.equal((await request('POST', { host: 'localhost:3090' })).status, 405)
  assert.equal((await request('GET', { host: 'evil.test' })).status, 403)
  assert.equal((await request('GET', { host: 'localhost:3090', origin: 'http://localhost:3001' })).status, 403)
  assert.equal(calls, 0)
  assert.equal((await request('GET', { host: 'localhost:3090' })).status, 200)
  fail = true
  const response = await request('GET', { host: 'localhost:3090' })
  assert.equal(response.status, 503)
  assert.equal(response.body.includes('PRIVATE'), false)
})
