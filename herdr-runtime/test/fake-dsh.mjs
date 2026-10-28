import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
appendFileSync(process.env.DSH_HOME + '/starts', `${process.pid}\n`)
writeFileSync(process.env.DSH_HOME + '/child-env.json', JSON.stringify({ pane: process.env.HERDR_PANE_ID, inside: process.env.HERDR_ENV, custom: process.env.RUNTIME_TEST_CUSTOM }))
console.log('http://127.0.0.1/?token=FAKE_SECRET_NEVER_PUBLIC')
if (process.stdin.isTTY) {
  writeFileSync(process.env.DSH_HOME + '/tty.json', JSON.stringify({ input: process.stdin.isTTY, output: process.stdout.isTTY, profile: process.argv[process.argv.indexOf('--profile') + 1] }))
  process.stdin.setRawMode(true)
  process.stdin.on('data', data => appendFileSync(process.env.DSH_HOME + '/input', data))
  process.on('SIGWINCH', () => writeFileSync(process.env.DSH_HOME + '/resize', 'yes'))
}
createServer((req, res) => res.end('fixture')).listen(port, '127.0.0.1')
process.on('SIGTERM', () => process.exit(0))
