import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
appendFileSync(process.env.DSH_HOME + '/starts', `${process.pid}\n`)
writeFileSync(process.env.DSH_HOME + '/child-env.json', JSON.stringify({ pane: process.env.HERDR_PANE_ID, inside: process.env.HERDR_ENV, custom: process.env.RUNTIME_TEST_CUSTOM }))
console.log('http://127.0.0.1/?token=FAKE_SECRET_NEVER_PUBLIC')
createServer((req, res) => res.end('fixture')).listen(port, '127.0.0.1')
process.on('SIGTERM', () => process.exit(0))
