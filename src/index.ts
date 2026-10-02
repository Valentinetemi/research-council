import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMCPClient } from '@ai-sdk/mcp'
import { runCouncil, type AgentResult, type JudgeOutput } from './council.js'
import {
  assessEvidenceRelevance,
  collectEvidence,
  DEFAULT_RELEVANCE_THRESHOLDS,
  type Entry,
  type RelevanceAssessment,
} from './evidence.js'
import { unbackedNumbers, verifyClaim, type Claim, type Verdict } from './verify.js'

export const DEFAULT_QUESTION =
  'Does structured graph memory outperform simple caption memory for long-term video memory? ' +
  'Cite the exact sources and the benchmark, model and subset behind every number.'

export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
export const RUNS_DIR = 'runs'

export type Run = {
  createdAt: string
  question: string
  model: string
  knowledgeBase: string
  evidence: Entry[]
  agents: AgentResult[]
  judge: JudgeOutput
}

export class OutsideCollectionError extends Error {
  constructor(public readonly assessment: RelevanceAssessment) {
    super('The available research collection does not contain enough relevant evidence to investigate this question reliably.')
    this.name = 'OutsideCollectionError'
  }
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

const relevanceThresholds = () => ({
  minEntries: numberFromEnv('RETRIEVAL_MIN_ENTRIES', DEFAULT_RELEVANCE_THRESHOLDS.minEntries),
  minTopScore: numberFromEnv('RETRIEVAL_MIN_TOP_SCORE', DEFAULT_RELEVANCE_THRESHOLDS.minTopScore),
  minTotalScore: numberFromEnv('RETRIEVAL_MIN_TOTAL_SCORE', DEFAULT_RELEVANCE_THRESHOLDS.minTotalScore),
  minMatchedTerms: numberFromEnv('RETRIEVAL_MIN_MATCHED_TERMS', DEFAULT_RELEVANCE_THRESHOLDS.minMatchedTerms),
  minTermCoverage: numberFromEnv('RETRIEVAL_MIN_TERM_COVERAGE', DEFAULT_RELEVANCE_THRESHOLDS.minTermCoverage),
})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

// Fetch the knowledge base outline over HTTP to find the knowledge base id.
async function fetchKnowledgeBaseId(mcpUrl: string, headers: Record<string, string>): Promise<string> {
  const url = new URL(mcpUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/initial-context`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`initial-context failed: ${res.status} ${await res.text()}`)
  const id = (await res.text()).match(/Knowledge base id: `([^`]+)`/)?.[1]
  if (!id) throw new Error('No knowledge base id found in initial context')
  return id
}

export async function liveRun(
  question = DEFAULT_QUESTION,
  log: (line: string) => void = console.log,
): Promise<Run> {
  const mcpUrl = requireEnv('SANITY_CONTEXT_MCP_URL')
  const headers = { Authorization: `Bearer ${requireEnv('SANITY_ORGANIZATION_TOKEN')}` }
  requireEnv('GOOGLE_GENERATIVE_AI_API_KEY') // read by @ai-sdk/google

  log(`Model: ${MODEL}\nQuestion: ${question}\n`)
  log('[1/3] Collecting evidence from the knowledge base (no model calls)…')
  const [mcpClient, knowledgeBase] = await Promise.all([
    createMCPClient({ transport: { type: 'http', url: mcpUrl, headers } }),
    fetchKnowledgeBaseId(mcpUrl, headers),
  ])
  let evidence: Entry[]
  try {
    const tools = await mcpClient.tools()
    evidence = await collectEvidence(tools, knowledgeBase, question, { log })
  } finally {
    await mcpClient.close()
  }
  const relevance = assessEvidenceRelevance(question, evidence, relevanceThresholds())
  if (!relevance.sufficient) {
    log(
      `Retrieval gate rejected the question (top score ${relevance.topScore.toFixed(1)}, ` +
        `${relevance.matchedTerms.length} matched terms). No model calls were made.`,
    )
    throw new OutsideCollectionError(relevance)
  }
  log(
    `Retrieval gate passed (top score ${relevance.topScore.toFixed(1)}, ` +
      `${Math.round(relevance.termCoverage * 100)}% term coverage).`,
  )

  const { agents, judge } = await runCouncil(MODEL, question, evidence, log)
  const run: Run = { createdAt: new Date().toISOString(), question, model: MODEL, knowledgeBase, evidence, agents, judge }

  await mkdir(RUNS_DIR, { recursive: true })
  const file = join(RUNS_DIR, `${run.createdAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(file, JSON.stringify(run, null, 2))
  log(`\nSaved run to ${file} (replay with: npm run replay -- ${file})`)
  return run
}

export async function loadRun(file?: string, log: (line: string) => void = console.log): Promise<Run> {
  if (!file) {
    const files = (await readdir(RUNS_DIR).catch(() => [])).filter((f) => f.endsWith('.json')).sort()
    if (files.length === 0) throw new Error(`No saved runs in ${RUNS_DIR}/`)
    file = join(RUNS_DIR, files[files.length - 1])
  }
  log(`Replaying ${file} (no model calls)\n`)
  return JSON.parse(await readFile(file, 'utf8'))
}

function printClaims(verdicts: Verdict[]) {
  if (verdicts.length === 0) console.log('  (no claims)')
  for (const [i, v] of verdicts.entries()) {
    console.log(`\n  [${i + 1}] ${v.verified ? 'VERIFIED' : 'REJECTED'}: ${v.claim.claim}`)
    const fields = Object.entries(v.claim.result ?? {}).filter(([, val]) => val).map(([k, val]) => `${k}=${val}`)
    if (fields.length) console.log(`      result: ${fields.join(' | ')}`)
    if (v.numbers.length) console.log(`      numbers checked: ${v.numbers.join(', ')}`)
    if (v.verified) {
      for (const s of v.sources) console.log(`      proof: ${s.path}\n        "${s.quote}"`)
    } else {
      for (const reason of v.reasons) console.log(`      reason: ${reason}`)
      for (const s of v.sources) console.log(`      cited: ${s.path} (${s.found ? 'quote found' : 'quote NOT found'})\n        "${s.quote}"`)
    }
  }
}

// Verification is plain code over the saved evidence, so it runs identically for live and replayed runs.
export function report(run: Run) {
  const entries = new Map(run.evidence.map((e) => [e.path, e.text]))
  const verify = (claims: Claim[]) => claims.map((c) => verifyClaim(c, entries))
  const tally = (vs: Verdict[]) => `${vs.filter((v) => v.verified).length}/${vs.length} verified`

  console.log(`\nEvidence: ${run.evidence.map((e) => e.path).join(', ')}`)

  const agentTallies: string[] = []
  for (const agent of run.agents) {
    console.log(`\n=== ${agent.name} ===`)
    if (!agent.ok) {
      console.log(`  FAILED: ${agent.error}`)
      agentTallies.push(`${agent.name}: failed`)
      continue
    }
    console.log(`  ${agent.output.summary}`)
    const verdicts = verify(agent.output.claims)
    const loose = unbackedNumbers(agent.output.summary, verdicts)
    if (loose.length) console.log(`  WARNING: summary uses numbers not backed by any verified quote: ${loose.join(', ')}`)
    printClaims(verdicts)
    agentTallies.push(`${agent.name}: ${tally(verdicts)}`)
  }

  const judgeVerdicts = verify(run.judge.claims)
  console.log(`\n=== Judge ===\n  Verdict: ${run.judge.verdict.toUpperCase()}\n  ${run.judge.reasoning}`)
  const loose = unbackedNumbers(run.judge.reasoning, judgeVerdicts)
  if (loose.length) console.log(`  WARNING: reasoning uses numbers not backed by any verified quote: ${loose.join(', ')}`)
  printClaims(judgeVerdicts)
  if (run.judge.openQuestions.length) {
    console.log('\n  Open questions:')
    for (const q of run.judge.openQuestions) console.log(`  - ${q}`)
  }

  console.log(`\n=== Summary ===\n  ${[...agentTallies, `Judge: ${tally(judgeVerdicts)}`].join('\n  ')}`)
}

async function main() {
  const args = process.argv.slice(2)
  const replayAt = args.indexOf('--replay')
  const run = replayAt === -1 ? await liveRun() : await loadRun(args[replayAt + 1])
  report(run)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nError: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
