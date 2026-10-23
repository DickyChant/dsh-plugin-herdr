import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('host packages cannot shadow the DSH runtime through installed dependencies', () => {
  for (const name of [
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-jobs',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-protocol',
  ]) {
    assert.equal(manifest.dependencies[name], undefined, name)
    assert.ok(manifest.peerDependencies[name], name)
    assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, name)
    assert.ok(manifest.devDependencies[name], name)
  }
})
