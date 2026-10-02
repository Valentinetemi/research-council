// The research council: four agents in parallel, then a judge. One generateObject call each.

import { google } from '@ai-sdk/google'
import { APICallError, generateObject, RetryError } from 'ai'
import { z } from 'zod'
import type { Entry } from './evidence.js'
import { verifyClaim, type Claim, type Verdict } from './verify.js'

const claimSchema = z.object({
  claim: z.string().describe('One self-contained factual statement.'),
  sources: z
    .array(
      z.object({
        path: z.string().describe('Entry path exactly as given in the evidence, e.g. "memory_retrieval".'),
        quote: z.string().describe('Verbatim text copied from that entry that supports the claim.'),
      }),
    )
    .min(1),
  result: z
    .object({
      benchmark: z.string().optional(),
      dataset: z.string().optional().describe('Dataset or subset/split.'),
      model: z.string().optional(),
      metric: z.string().optional(),
    })
    .optional()
    .describe('Fill only when the claim reports an experimental result.'),
})

const agentSchema = z.object({
  summary: z.string().describe('Two or three sentences interpreting your claims. No numbers and no new facts.'),
  claims: z.array(claimSchema),
})

const judgeSchema = z.object({
  verdict: z.enum(['yes', 'no', 'mixed', 'insufficient evidence']),
  reasoning: z.string().describe('Why, in a short paragraph. Only use numbers that appear in your claims.'),
  claims: z.array(claimSchema).describe('The claims the verdict rests on.'),
  openQuestions: z.array(z.string()).describe('What the evidence does not settle.'),
})

export type AgentOutput = z.infer<typeof agentSchema>
export type JudgeOutput = z.infer<typeof judgeSchema>
export type AgentResult = { name: string; ok: true; output: AgentOutput } | { name: string; ok: false; error: string }

const CLAIM_RULES = `Rules for claims:
- Use only the evidence below. Every claim needs at least one source: the entry path and a quote copied
  character-for-character from that entry (one or two contiguous sentences, no paraphrasing, no ellipses).
- Every number in a claim must appear in one of its quotes. For results, fill in benchmark, dataset/subset, model and metric.
- Claims are your only way to contribute facts. Report every relevant result as a claim (aim for 3-8), including
  indirect evidence when there is no exact head-to-head comparison; say in the claim what it does and does not compare.
- Return no claims only if no entry is relevant. Never put facts in the summary that are not in your claims.
Claims are checked automatically against the entries; unsupported claims are rejected.`

const AGENTS: { name: string; role: string }[] = [
  {
    name: 'Researcher A',
    role: 'Answer the question. Focus on direct head-to-head results between the approaches being compared.',
  },
  {
    name: 'Researcher B',
    role: 'Answer the question independently. Look for results that could support the opposite conclusion, and for conditions (benchmark, model, subset) under which the answer changes.',
  },
  {
    name: 'Contradiction Hunter',
    role: 'Find places where entries disagree, or report different numbers for the same comparison. State each side as its own claim, with its own source.',
  },
  {
    name: 'Evidence Auditor',
    role: 'Check whether the comparisons are like-for-like: same benchmark, subset, backbone model and metric. Make claims about confounds and mismatches, and note in the summary what the evidence does not show.',
  },
]

export const formatEvidence = (entries: Entry[]) =>
  entries.map((e) => `<entry path="${e.path}">\n${e.text}\n</entry>`).join('\n\n')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One request, at most one retry, never retrying a 429 (on the free tier a retry only burns quota).
async function oneCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const cause = RetryError.isInstance(err) ? err.lastError : err
    if (APICallError.isInstance(cause) && cause.isRetryable && cause.statusCode !== 429) {
      await sleep(3000)
      return fn()
    }
    throw cause
  }
}

const describeError = (err: unknown) =>
  APICallError.isInstance(err) ? `HTTP ${err.statusCode}: ${err.message.split('\n')[0]}` : String((err as Error)?.message ?? err)

export async function runCouncil(
  modelId: string,
  question: string,
  entries: Entry[],
  log: (line: string) => void = console.log,
) {
  const model = google(modelId)
  const evidence = formatEvidence(entries)
  const entryMap = new Map(entries.map((e) => [e.path, e.text]))

  log(`[2/3] Running ${AGENTS.length} agents in parallel (${AGENTS.length} requests)…`)
  const agents: AgentResult[] = await Promise.all(
    AGENTS.map(async ({ name, role }): Promise<AgentResult> => {
      const start = Date.now()
      try {
        const { object } = await oneCall(() =>
          generateObject({
            model,
            schema: agentSchema,
            maxRetries: 0,
            system: `You are ${name} on a research council. ${role}\n\n${CLAIM_RULES}`,
            prompt: `Question: ${question}\n\n# Evidence\n\n${evidence}`,
          }),
        )
        log(`    ✓ ${name}: ${object.claims.length} claims (${((Date.now() - start) / 1000).toFixed(1)}s)`)
        return { name, ok: true, output: object }
      } catch (err) {
        log(`    ✗ ${name}: ${describeError(err)}`)
        return { name, ok: false, error: describeError(err) }
      }
    }),
  )

  const succeeded = agents.filter((a) => a.ok)
  if (succeeded.length === 0) throw new Error('All agents failed; skipping the judge.')

  // Tell the judge which agent claims passed the deterministic check, so it builds on verified ones.
  const briefing = succeeded
    .map((a) => {
      const claims = a.output.claims.map((c: Claim) => {
        const v: Verdict = verifyClaim(c, entryMap)
        return `- [${v.verified ? 'VERIFIED' : 'REJECTED: ' + v.reasons.join('; ')}] ${c.claim}\n  sources: ${JSON.stringify(c.sources)}`
      })
      return `## ${a.name}\nSummary: ${a.output.summary}\n${claims.join('\n')}`
    })
    .join('\n\n')

  log('[3/3] Running the Judge (1 request)…')
  const start = Date.now()
  const { object: judge } = await oneCall(() =>
    generateObject({
      model,
      schema: judgeSchema,
      maxRetries: 0,
      system: `You are the Judge of a research council. Weigh the agents' findings against the evidence and give a verdict.
Build only on VERIFIED claims or on quotes you check in the evidence yourself; ignore REJECTED claims unless the evidence supports them.
Where agents disagree, say which side the evidence supports, or that it is mixed.\n\n${CLAIM_RULES}`,
      prompt: `Question: ${question}\n\n# Agent findings\n\n${briefing}\n\n# Evidence\n\n${evidence}`,
    }),
  ).catch((err) => {
    throw new Error(`Judge failed: ${describeError(err)}`)
  })
  log(`    ✓ Judge: verdict "${judge.verdict}", ${judge.claims.length} claims (${((Date.now() - start) / 1000).toFixed(1)}s)`)

  return { agents, judge }
}
