import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { guardLocalRequest } from './http-guard.ts'

interface Bridge {
  chat(input: unknown): Promise<unknown>
  send(input: unknown): Promise<unknown>
  subscribe(input: unknown, listener: (event: string, data: unknown) => void): Promise<() => void>
}
interface WebServer {
  register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void
}

export function bridgeToken(path = process.env.HERDR_DSH_TOKEN_FILE ?? join(homedir(), '.config', 'ovis-dsh', 'bridge-token')): string | undefined {
  try {
    const token = readFileSync(path, 'utf8').trim()
    return /^[a-f0-9]{64}$/.test(token) ? token : undefined
  } catch { return undefined }
}

export function registerBotChat(ctx: Context, token = bridgeToken()): void {
  ctx.inject(['webServer'], webCtx => {
    let bridge: Bridge | undefined
    const active = new Set<() => void>()
    webCtx.inject(['botBridge'], botCtx => {
      bridge = (botCtx as unknown as { botBridge: Bridge }).botBridge
      botCtx.effect(() => () => { bridge = undefined; for (const close of active) close() }, 'herdr: bot chat source')
    })
    const webServer = (webCtx as unknown as { webServer: WebServer }).webServer
    for (const action of ['chat', 'send', 'events'] as const) {
      const off = webServer.register({ kind: 'exact', path: `/herdr-bots/${action}`, handler: async (req, res) => {
        const json = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        const guard = guardLocalRequest(req)
        if (!guard.ok) return json(guard.status, { error: 'forbidden' })
        const expected = Buffer.from(`Bearer ${token ?? ''}`)
        const actual = Buffer.from(req.headers.authorization ?? '')
        if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(401, { error: 'unauthorized' })
        if (req.method !== (action === 'events' ? 'GET' : 'POST')) return json(405, { error: 'method_not_allowed' })
        if (!bridge) return json(503, { error: 'unavailable' })
        try {
          let input: unknown
          if (action === 'events') {
            const url = new URL(req.url ?? '', 'http://localhost')
            input = { runtimeId: url.searchParams.get('runtimeId'), botId: url.searchParams.get('botId') }
          } else {
            let body = ''
            const decoder = new TextDecoder()
            let bytes = 0
            for await (const chunk of req) {
              bytes += chunk.length
              if (bytes > 140000) return json(413, { error: 'too_large' })
              body += decoder.decode(chunk, { stream: true })
            }
            try { input = JSON.parse(body + decoder.decode()) } catch { return json(400, { error: 'invalid' }) }
          }
          if (action !== 'events') return json(200, await bridge[action](input))
          if (active.size >= 32) return json(429, { error: 'too_many_streams' })
          let closed = false
          let unsubscribe = () => {}
          let heartbeat: ReturnType<typeof setInterval> | undefined
          let expiry: ReturnType<typeof setTimeout> | undefined
          const close = () => {
            if (closed) return
            closed = true; unsubscribe(); clearInterval(heartbeat); clearTimeout(expiry); active.delete(close); res.end()
          }
          const write = (event: string, data: unknown) => {
            if (!closed && !res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) close()
          }
          res.on('close', close)
          unsubscribe = await bridge.subscribe(input, write)
          if (closed || res.destroyed) { unsubscribe(); return }
          active.add(close)
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
          write('ready', {})
          heartbeat = setInterval(() => write('ping', {}), 10000)
          expiry = setTimeout(close, 300000)
        } catch (error) {
          if (res.headersSent) { res.end(); return }
          const code = (error as { code?: string })?.code
          const known = ['bot/invalid', 'bot/target-changed', 'bot/not-found', 'bot/read-only', 'bot/setup-required', 'bot/request-conflict', 'bot/send-refused']
          json(code && known.includes(code) ? 409 : 503, { error: code && known.includes(code) ? code : 'unavailable' })
        }
      } })
      webCtx.effect(() => () => { off(); for (const close of active) close() }, `herdr: bot ${action} route`)
    }
  })
}
