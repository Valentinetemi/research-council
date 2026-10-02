import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { DEMO_DEFINITIONS } from '../src/demo-catalog.js'

test('generated demos contain no full source text or knowledge-base identifier', async () => {
  for (const definition of DEMO_DEFINITIONS) {
    const raw = await readFile(join(process.cwd(), 'demos', definition.file), 'utf8')
    assert.doesNotMatch(raw, /"knowledgeBase"\s*:/)
    assert.doesNotMatch(raw, /"text"\s*:/)
    assert.doesNotMatch(raw, /"characters"\s*:/)
    const demo = JSON.parse(raw)
    assert.equal(demo.slug, definition.slug)
    assert.ok(demo.report.sources.every((source: { passages: unknown[] }) => Array.isArray(source.passages)))
  }
})
