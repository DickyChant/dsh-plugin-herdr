import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_ID = 'dickychant.dsh-runtime'
const root = dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readJson = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback

function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  renameSync(temp, file)
}

export function settings(env = process.env) {
  const configDir = env.HERDR_PLUGIN_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr/plugins/config', PLUGIN_ID)
  const config = readJson(join(configDir, 'runtime.json'), {})
  const home = resolve(config.home || env.DSH_HOME || join(homedir(), '.dsh'))
  const state = join(home, '.herdr-runtime', 'web')
  const port = config.port ?? 3080
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1–65535')
  const command = config.command || ['dsh']
  if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string' || !x || x.includes('\0'))) throw new Error('command must be a nonempty argv array')
  const socket = join(state, 'control.sock')
  if (Buffer.byteLength(socket) > 103) throw new Error('DSH home path is too long for the control socket')
  return { configDir, home, state, socket, port, command, cwd: resolve(config.cwd || homedir()), env: config.env || {} }
}

function prepare(s) {
  mkdirSync(s.state, { recursive: true, mode: 0o700 })
  chmodSync(s.state, 0o700)
}

// Control output contains only lifecycle metadata. DSH's raw output is never forwarded
// to a Herdr pane/action: it can contain login URLs, prompts and credentials.
export function control(s, command = 'status') {
  return new Promise(resolve => {
    const client = createConnection(s.socket)
    let buffer = ''
    const done = value => { client.destroy(); resolve(value) }
    client.setTimeout(1500, () => done(null))
    client.on('error', () => done(null))
    client.on('connect', () => client.write(`${command}\n`))
    client.on('data', data => {
      buffer += data
      if (buffer.length > 8192) return done(null)
      if (buffer.includes('\n')) {
        try { done(JSON.parse(buffer.split('\n')[0])) } catch { done(null) }
      }
    })
    client.on('end', () => done(null))
  })
}

export function portBusy(port) {
  return new Promise(resolve => {
    const client = createConnection({ host: '127.0.0.1', port })
    const done = value => { client.destroy(); resolve(value) }
    client.setTimeout(500, () => done(true))
    client.on('connect', () => done(true))
    client.on('error', error => done(error.code !== 'ECONNREFUSED'))
  })
}

function herdr(args) {
  const env = { ...process.env }
  if (env.HERDR_SOCKET_PATH) env.HERDR_SOCKET = env.HERDR_SOCKET_PATH
  const result = spawnSync(env.HERDR_BIN_PATH || 'herdr', args, { env, encoding: 'utf8', timeout: 5000 })
  let response
  try { response = JSON.parse(result.stdout) } catch { /* report only our argv, never child output */ }
  if (result.status !== 0 || response?.error || !response?.result) throw new Error(`Herdr command failed: ${args.slice(0, 3).join(' ')}`)
  return response.result
}

function enabled(s) { return readJson(join(s.state, 'desired.json'), { enabled: false }).enabled === true }
function setEnabled(s, value) { atomicJson(join(s.state, 'desired.json'), { enabled: value }) }
function serverKey() { return process.env.HERDR_SOCKET_PATH || process.env.HERDR_SOCKET || 'default' }

function log(s, message) {
  const file = join(s.state, 'events.log')
  if (existsSync(file) && statSync(file).size > 256 * 1024) renameSync(file, `${file}.1`)
  const line = `${new Date().toISOString()} ${message}\n`
  appendFileSync(file, line, { mode: 0o600 })
  process.stdout.write(line)
}

async function start(s, explicit) {
  if (explicit) setEnabled(s, true)
  if (!enabled(s)) return { state: 'stopped', enabled: false }
  const running = await control(s)
  if (running) return running
  // Neither take over an external listener nor start a competing profile writer.
  if (await portBusy(s.port)) return { state: 'external-listener', port: s.port, managed: false }
  const snapshot = herdr(['api', 'snapshot']).snapshot
  const recordsFile = join(s.state, 'panes.json')
  const records = readJson(recordsFile, {})
  const previous = records[serverKey()]
  // Only replace our recorded, uniquely labelled pane if it is an idle restored
  // shell. A repurposed/renamed pane or one doing work is left untouched.
  if (previous) {
    const pane = snapshot.panes.find(p => p.pane_id === previous.pane && p.label === previous.label && p.cwd === previous.root)
    if (pane) {
      const info = herdr(['pane', 'process-info', '--pane', pane.pane_id]).process_info
      const idle = info.foreground_processes?.every(p => p.pid === info.shell_pid && /^(?:-)?(?:ba|z|fi|da)?sh$/.test(p.name))
      if (idle && pane.terminal_id !== previous.terminal) herdr(['pane', 'close', pane.pane_id])
    }
  }
  let workspace = snapshot.focused_workspace_id || snapshot.workspaces[0]?.workspace_id
  if (!workspace) workspace = herdr(['workspace', 'create', '--cwd', s.cwd, '--label', 'DSH', '--no-focus']).workspace.workspace_id
  const label = `DSH Web [${randomUUID().slice(0, 8)}]`
  const pane = herdr(['plugin', 'pane', 'open', '--plugin', PLUGIN_ID, '--entrypoint', 'runtime', '--placement', 'tab', '--workspace', workspace, '--cwd', root, '--env', `DSH_RUNTIME_NODE=${process.execPath}`, '--no-focus']).plugin_pane.pane
  herdr(['pane', 'rename', pane.pane_id, label])
  records[serverKey()] = { pane: pane.pane_id, label, root, terminal: pane.terminal_id }
  atomicJson(recordsFile, records)
  for (let n = 0; n < 100; n++) {
    const runtime = await control(s)
    if (runtime) return runtime
    await sleep(100)
  }
  throw new Error('Supervisor did not start; check the DSH Web pane and Node/flock availability')
}

async function stop(s) {
  setEnabled(s, false)
  const running = await control(s, 'stop')
  if (!running) return { state: 'stopped', enabled: false, externalListener: await portBusy(s.port) }
  for (let n = 0; n < 150; n++) {
    if (!await control(s)) return { state: 'stopped', enabled: false }
    await sleep(100)
  }
  throw new Error('Supervisor did not finish stopping; inspect its service tab')
}

async function serve(s) {
  // Only entered through launch.sh with the kernel-held runtime.lock.
  if (!enabled(s)) return
  rmSync(s.socket, { force: true })
  let child = null
  let childResult = null
  let stopping = false
  let state = 'starting'
  let failures = 0
  let exitCode = null
  let killTimer
  let lastReport = ''
  const status = () => ({ state, enabled: enabled(s), managed: true, pid: process.pid, childPid: child?.pid ?? null, port: s.port, pane: process.env.HERDR_PANE_ID || null, failures, exitCode })
  const signalChild = signal => {
    if (!child?.pid) return
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const shutdown = () => {
    stopping = true
    state = 'stopping'
    signalChild('SIGTERM')
    if (!killTimer) killTimer = setTimeout(() => signalChild('SIGKILL'), 5000)
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, shutdown)
  const server = createServer(client => {
    client.setTimeout(1500, () => client.destroy())
    let input = ''
    client.on('error', () => {})
    client.on('data', chunk => {
      input += chunk
      if (input.length > 64) return client.destroy()
      if (!input.includes('\n')) return
      const command = input.split('\n')[0]
      if (command === 'stop') { setEnabled(s, false); shutdown() }
      client.end(JSON.stringify(status()) + '\n')
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(s.socket, resolve) })
  chmodSync(s.socket, 0o600)
  log(s, 'Supervisor started')
  const env = { ...process.env, ...s.env, DSH_HOME: s.home }
  for (const key of Object.keys(env)) if (key.startsWith('HERDR_PLUGIN_') || ['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_WORKSPACE_ID', 'HERDR_TAB_ID'].includes(key)) delete env[key]
  const rawLog = join(s.state, 'dsh.log')
  const report = () => {
    if (!process.env.HERDR_PANE_ID || lastReport === state) return
    try {
      herdr(['pane', 'report-agent', process.env.HERDR_PANE_ID, '--source', PLUGIN_ID, '--agent', 'dsh-web', '--state', state === 'ready' ? 'idle' : state === 'starting' ? 'working' : 'blocked', '--message', `DSH Web: ${state}`, '--seq', String(Date.now())])
      herdr(['pane', 'report-metadata', process.env.HERDR_PANE_ID, '--source', PLUGIN_ID, '--applies-to-source', PLUGIN_ID, '--display-agent', 'DSH Web', '--title', `DSH Web: ${state}`, '--state-label', 'done=Ready', '--state-label', 'working=Starting', '--state-label', 'blocked=Needs attention', '--seq', String(Date.now())])
      lastReport = state
    } catch { /* Lifecycle must still shut down if Herdr is exiting. */ }
  }
  // Capture privately and cap disk usage. Never copy arbitrary child output into
  // event logs; a blacklist of token spellings would not reliably redact it.
  const capture = data => {
    try {
      if (existsSync(rawLog) && statSync(rawLog).size > 2 * 1024 * 1024) renameSync(rawLog, `${rawLog}.1`)
      appendFileSync(rawLog, data, { mode: 0o600 })
    } catch { shutdown() }
  }
  const refresh = setInterval(() => { lastReport = ''; report() }, 15000)
  try {
    while (!stopping && enabled(s)) {
      if (await portBusy(s.port)) {
        state = 'external-listener'
        report()
        await sleep(1000)
        continue
      }
      state = 'starting'
      report()
      const began = Date.now()
      exitCode = null
      child = spawn(s.command[0], [...s.command.slice(1), 'web', '--host', '127.0.0.1', '--port', String(s.port), '--no-open'], { cwd: s.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      const result = childResult = new Promise(resolve => {
        child.once('error', error => resolve(error.code || 'spawn-error'))
        child.once('exit', (code, signal) => resolve(code ?? signal))
      })
      let exited = false
      result.then(() => { exited = true })
      log(s, 'DSH Web process started')
      while (!exited && !stopping && enabled(s)) {
        if (state === 'starting' && await portBusy(s.port)) { state = 'ready'; log(s, 'DSH Web is listening on loopback'); report() }
        await sleep(250)
      }
      if (!exited) shutdown()
      exitCode = await result
      // Reap any tools still in this child's process group before starting again.
      signalChild('SIGTERM')
      child = null
      childResult = null
      if (stopping || !enabled(s)) break
      failures = Date.now() - began > 60000 ? 1 : failures + 1
      state = 'backoff'
      const delay = Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5))
      log(s, `DSH Web exited; retry in ${delay / 1000}s (attempt ${failures})`)
      report()
      const until = Date.now() + delay
      while (!stopping && enabled(s) && Date.now() < until) await sleep(100)
    }
  } finally {
    clearInterval(refresh)
    shutdown()
    if (childResult) await childResult
    clearTimeout(killTimer)
    server.close()
    rmSync(s.socket, { force: true })
    log(s, 'Supervisor stopped')
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeListener(signal, shutdown)
  }
}

export async function main(command = process.argv[2] || 'status') {
  const s = settings()
  prepare(s)
  if (command === 'lock-path' || command === 'action-lock-path') return console.log(join(s.state, command === 'lock-path' ? 'runtime.lock' : 'action.lock'))
  if (command === 'serve') return serve(s)
  if (command === 'start' || command === 'ensure') return console.log(JSON.stringify(await start(s, command === 'start')))
  if (command === 'stop') return console.log(JSON.stringify(await stop(s)))
  if (command === 'status') return console.log(JSON.stringify(await control(s) || { state: await portBusy(s.port) ? 'external-listener' : 'stopped', enabled: enabled(s), managed: false, port: s.port }))
  if (command === 'logs') {
    const file = join(s.state, 'events.log')
    console.log(existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').slice(-60).join('\n') : 'No runtime events yet')
    return
  }
  throw new Error('Use start, stop, status, logs, or ensure')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
