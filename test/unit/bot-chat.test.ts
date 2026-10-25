import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import { registerBotChat } from '../../src/bot-chat.ts'

test('chat requires the private bridge credential, guards origins and bounds bodies', async () => {
  const routes = new Map<string, any>()
  const inputs: unknown[] = []
  const token = 'a'.repeat(64)
  const ctx: any = {
    webServer: { register(route: any) { routes.set(route.path, route); return () => {} } },
    botBridge: { async chat(input: unknown) { inputs.push(input); return { items: [] } }, async send(input: unknown) { inputs.push(input); return { accepted: true } } },
    inject(_keys: string[], callback: (ctx: unknown) => void) { callback(ctx) },
    effect(callback: () => unknown) { callback() },
  }
  registerBotChat(ctx as Context, token, 'b'.repeat(64))
  const run = async (body: Buffer[], headers = {}, method = 'POST', path = '/herdr-bots/chat') => {
    const req = Object.assign(Readable.from(body), { method, headers: { host: '127.0.0.1:3096', ...headers } })
    const res = Object.assign(new EventEmitter(), {
      status: 0, body: '', writeHead(status: number) { this.status = status }, end(body: string) { this.body = body },
    })
    await routes.get(path).handler(req, res)
    return res
  }
  const auth = { authorization: `Bearer ${token}` }
  ctx.botBridge.handoff = async (input: unknown) => input
  const scoped = { authorization: `Bearer ${'b'.repeat(64)}` }
  assert.equal((await run([Buffer.from('{}')], auth, 'POST', '/herdr-bots/handoff')).status, 401)
  assert.equal((await run([Buffer.from('{}')], scoped, 'POST', '/herdr-bots/send')).status, 401)
  assert.equal((await run([Buffer.from('{}')], scoped, 'POST', '/herdr-bots/handoff')).status, 200)
  assert.equal((await run([Buffer.from('{}')], { ...scoped, origin: 'http://evil.test' }, 'POST', '/herdr-bots/handoff')).status, 403)
  assert.equal((await run([])).status, 401)
  assert.equal((await run([], { ...auth, origin: 'http://evil.test' })).status, 403)
  assert.equal((await run([], auth, 'GET')).status, 405)
  assert.equal((await run([Buffer.alloc(140001)], auth)).status, 413)
  const bytes = Buffer.from(JSON.stringify({ text: '你好' }))
  assert.equal((await run([bytes.subarray(0, 11), bytes.subarray(11)], auth)).status, 200)
  assert.deepEqual(inputs, [{ text: '你好' }])
  for (const action of ['settings', 'control', 'upload', 'download', 'approvals', 'answer']) {
    ctx.botBridge[action] = async (input: unknown) => input
    assert.equal((await run([], {}, 'POST', `/herdr-bots/${action}`)).status, 401)
    assert.equal((await run([Buffer.from('{}')], { ...auth, origin: 'http://evil.test' }, 'POST', `/herdr-bots/${action}`)).status, 403)
    assert.equal((await run([Buffer.from('{}')], auth, 'POST', `/herdr-bots/${action}`)).status, 200)
  }
  ctx.botBridge.send = async () => { throw new Error('PRIVATE') }
  const failure = await run([Buffer.from('{}')], auth, 'POST', '/herdr-bots/send')
  assert.equal(failure.status, 503)
  assert.equal(failure.body.includes('PRIVATE'), false)
})
