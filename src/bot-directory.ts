import type { Context } from '@deepseek-ai/cordis'
import { guardLocalRequest, requireMethod, type GuardedRequest } from './http-guard.ts'

interface Directory { snapshot(): Promise<unknown> }
interface Response {
  writeHead(status: number, headers: Record<string, string>): void
  end(body: string): void
}
interface WebServer {
  register(route: { kind: 'exact'; path: string; handler(req: GuardedRequest, res: Response): Promise<void> }): () => void
}

/** Optional DS Bot integration; neither DS Bot nor a Web server is required by Herdr tools. */
export function registerBotDirectory(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => {
    let directory: Directory | undefined
    webCtx.inject(['botDirectory'], botCtx => {
      directory = (botCtx as unknown as { botDirectory: Directory }).botDirectory
      botCtx.effect(() => () => { directory = undefined }, 'herdr: bot directory source')
    })
    const webServer = (webCtx as unknown as { webServer: WebServer }).webServer
    const off = webServer.register({
      kind: 'exact', path: '/herdr-bots',
      handler: async (req, res) => {
        const send = (status: number, value: unknown, extra = {}) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
          res.end(JSON.stringify(value))
        }
        const method = requireMethod(req, 'GET')
        if (!method.ok) return send(method.status, { error: method.message }, { allow: 'GET' })
        const guard = guardLocalRequest(req)
        if (!guard.ok) return send(guard.status, { error: guard.message })
        if (!directory) return send(503, { error: 'bot_directory_unavailable' })
        try { send(200, await directory.snapshot()) }
        catch { send(503, { error: 'bot_directory_unavailable' }) }
      },
    })
    webCtx.effect(() => off, 'herdr: bot directory route')
  })
}
