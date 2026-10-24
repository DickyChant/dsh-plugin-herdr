import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { control, settings } from '../runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout
  do { const value = await check(); if (value) return value; await delay(50) } while (Date.now() < deadline)
  throw new Error('Timed out')
}
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rt-'))
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  mkdirSync(join(dir, 'config'))
  writeFileSync(join(dir, 'config/runtime.json'), JSON.stringify({ home: dir, cwd: dir, port, command: [process.execPath, join(root, 'test/fake-dsh.mjs')], env: { RUNTIME_TEST_CUSTOM: 'kept', HERDR_ENV: '1', HERDR_PANE_ID: 'fixture-pane' } }))
  const env = { ...process.env, HERDR_PLUGIN_CONFIG_DIR: join(dir, 'config'), DSH_RUNTIME_NODE: process.execPath }
  for (const key of Object.keys(env)) if (key.startsWith('HERDR_') && key !== 'HERDR_PLUGIN_CONFIG_DIR') delete env[key]
  const s = settings(env)
  mkdirSync(s.state, { recursive: true })
  const desired = value => writeFileSync(join(s.state, 'desired.json'), JSON.stringify({ enabled: value }))
  const children = []
  const run = command => {
    const child = spawn('sh', [join(root, 'launch.sh'), command], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const done = new Promise(resolve => child.on('exit', code => resolve({ code, output })))
    children.push(child)
    return { child, done }
  }
  t.after(async () => {
    desired(false)
    await control(s, 'stop')
    await delay(300)
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await delay(100)
    rmSync(dir, { recursive: true, force: true })
  })
  return { s, dir, run, desired }
}

test('one runtime, crash recovery, private logs, stripped pane context and sticky Stop', { timeout: 20000 }, async t => {
  const { s, dir, run, desired } = await fixture(t)
  desired(true)
  const first = run('supervise')
  const ready = await until(async () => { const s1 = await control(s); return s1?.state === 'ready' && s1 })
  const duplicate = await run('supervise').done
  assert.notEqual(duplicate.code, 0)
  assert.equal(readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n').length, 1)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'child-env.json'), 'utf8')), { custom: 'kept' })
  process.kill(ready.childPid, 'SIGKILL')
  const recovered = await until(async () => { const s1 = await control(s); return s1?.state === 'ready' && s1.childPid !== ready.childPid && s1 })
  assert.equal(recovered.failures, 1)
  const logs = await run('logs').done
  assert.doesNotMatch(logs.output, /FAKE_SECRET|token=/)
  assert.match(readFileSync(join(s.state, 'dsh.log'), 'utf8'), /FAKE_SECRET/)
  assert.equal(statSync(join(s.state, 'dsh.log')).mode & 0o777, 0o600)
  assert.equal(statSync(s.state).mode & 0o777, 0o700)
  assert.equal((await run('stop').done).code, 0)
  assert.equal((await first.done).code, 0)
  assert.equal(await control(s), null)
  assert.equal(JSON.parse(readFileSync(join(s.state, 'desired.json'), 'utf8')).enabled, false)
  assert.match((await run('ensure').done).output, /"state":"stopped"/)
  assert.equal((await run('supervise').done).code, 0)
  assert.equal(readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n').length, 2)
})

test('an external listener is neither duplicated nor stopped', { timeout: 10000 }, async t => {
  const { s, run, desired } = await fixture(t)
  const external = createServer(client => client.end()).listen(s.port, '127.0.0.1')
  await once(external, 'listening')
  t.after(() => external.close())
  desired(true)
  const started = await run('start').done
  assert.match(started.output, /external-listener/)
  assert.equal(await control(s), null)
  const stopped = await run('stop').done
  assert.match(stopped.output, /"externalListener":true/)
  assert.equal(external.listening, true)
})

test('HUP stops the owned child but preserves recovery intent', { timeout: 10000 }, async t => {
  const { s, run, desired } = await fixture(t)
  desired(true)
  const supervisor = run('supervise')
  const ready = await until(async () => { const s1 = await control(s); return s1?.state === 'ready' && s1 })
  supervisor.child.kill('SIGHUP')
  await supervisor.done
  assert.throws(() => process.kill(ready.childPid, 0), { code: 'ESRCH' })
  assert.equal(JSON.parse(readFileSync(join(s.state, 'desired.json'), 'utf8')).enabled, true)
  assert.equal(await control(s), null)
})

test('invalid ports fail before launching a process', async t => {
  const { dir } = await fixture(t)
  writeFileSync(join(dir, 'config/runtime.json'), '{"port":0}')
  assert.throws(() => settings({ HERDR_PLUGIN_CONFIG_DIR: join(dir, 'config') }), /port/)
})
