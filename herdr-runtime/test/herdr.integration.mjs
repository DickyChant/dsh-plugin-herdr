// Real Herdr, isolated config/session and a fake DSH. Never stops the user's server.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { control, PLUGIN_ID, settings } from '../runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const dir = mkdtempSync('/tmp/dsh-herdr-')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HERDR_')))
env.XDG_CONFIG_HOME = join(dir, 'config')
env.ZDOTDIR = join(dir, 'zdot')
mkdirSync(env.ZDOTDIR, { recursive: true })
writeFileSync(join(env.ZDOTDIR, '.zshrc'), '')
const configDir = join(env.XDG_CONFIG_HOME, 'herdr/plugins/config', PLUGIN_ID)
mkdirSync(configDir, { recursive: true })
const probe = createServer().listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
writeFileSync(join(configDir, 'runtime.json'), JSON.stringify({ home: dir, cwd: dir, port, command: [process.execPath, join(root, 'test/fake-dsh.mjs')] }))
const s = settings({ ...env, HERDR_PLUGIN_CONFIG_DIR: configDir })
const session = 'dsh-lifecycle-test'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const cli = (args, required = true) => {
  const run = spawnSync('herdr', ['--session', session, ...args], { env, encoding: 'utf8', timeout: 6000 })
  if (!required && run.status !== 0) return null
  assert.equal(run.status, 0, `${args.join(' ')}: ${run.stderr} ${run.stdout}`)
  if (!run.stdout.trim()) return {}
  const value = JSON.parse(run.stdout)
  assert.equal(value.error, undefined, JSON.stringify(value.error))
  return value.result
}
const until = async (check, timeout = 15000) => {
  const deadline = Date.now() + timeout
  do { const value = await check(); if (value) return value; await delay(100) } while (Date.now() < deadline)
  throw new Error('Timed out waiting for lifecycle transition')
}
let server
const startServer = async () => {
  const fd = openSync(join(dir, 'herdr.log'), 'a', 0o600)
  server = spawn('herdr', ['--session', session, 'server'], { env, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  await until(() => cli(['api', 'snapshot'], false))
}
const stopServer = async () => {
  const exited = once(server, 'exit')
  cli(['server', 'stop'])
  await exited
}
const invoke = action => cli(['plugin', 'action', 'invoke', action, '--plugin', PLUGIN_ID])
const snapshot = () => cli(['api', 'snapshot']).snapshot
try {
  cli(['plugin', 'link', root])
  await startServer()
  cli(['workspace', 'create', '--cwd', dir, '--label', 'DSH lifecycle fixture', '--no-focus'])
  await delay(200)
  assert.equal(await control(s), null, 'initial install must not auto-start')
  const initialFocus = snapshot().focused_pane_id
  invoke('start')
  let ready = await until(async () => { const value = await control(s); return value?.state === 'ready' && value })
  assert.equal(snapshot().focused_pane_id, initialFocus, 'Start must preserve focus')
  assert.ok(ready.pane, 'supervisor must know its owned pane')
  assert.equal(snapshot().panes.find(p => p.pane_id === ready.pane)?.agent_status, 'done', 'ready status must be visible in Herdr')
  for (let n = 0; n < 3; n++) invoke('start')
  await delay(600)
  assert.equal(readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n').length, 1)
  const firstPid = ready.childPid
  const firstPaneCount = snapshot().panes.length
  await stopServer()
  await until(async () => !await control(s))
  assert.throws(() => process.kill(firstPid, 0), { code: 'ESRCH' })
  await startServer()
  ready = await until(async () => { const value = await control(s); return value?.state === 'ready' && value })
  assert.notEqual(ready.childPid, firstPid)
  assert.equal(snapshot().panes.length, firstPaneCount, 'restart must not accumulate service tabs')
  assert.equal(snapshot().focused_pane_id, initialFocus, 'restart must preserve focus')
  invoke('stop')
  await until(async () => !await control(s))
  await stopServer()
  await startServer()
  await delay(1500)
  assert.equal(await control(s), null, 'intentional Stop must survive server restart')
  console.log('PASS: Herdr Start/Stop, duplicate Start, focus preservation, cold-start recovery, no extra tabs, sticky Stop')
} catch (error) {
  console.error('Lifecycle test failure:', error)
  process.exitCode = 1
} finally {
  await control(s, 'stop')
  if (server && server.exitCode === null && server.signalCode === null && cli(['api', 'snapshot'], false)) await stopServer()
  console.log(`Test evidence: ${dir}`)
  // Keep isolated logs for diagnosis, never any real DSH/user data.
}
