import assert from 'node:assert/strict'
import test from 'node:test'
import { assessEvidenceRelevance } from '../src/evidence.js'

test('retrieval gate accepts a well-supported in-collection question', () => {
  const result = assessEvidenceRelevance('How does episodic graph memory improve object retrieval?', [
    { path: 'memory/paper-a.md', score: 18, text: 'Episodic graph memory supports object retrieval over long videos.' },
    { path: 'memory/paper-b.md', score: 12, text: 'Object identity is maintained in episodic memory.' },
  ])
  assert.equal(result.sufficient, true)
})

test('retrieval gate fails closed for unrelated evidence', () => {
  const result = assessEvidenceRelevance('What treatment cures an uncommon cardiac condition?', [
    { path: 'memory/paper-a.md', score: 4, text: 'Graph memory supports object retrieval in video.' },
  ])
  assert.equal(result.sufficient, false)
})
