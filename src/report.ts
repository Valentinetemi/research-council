import type { AgentResult } from './council.js'
import type { Run } from './index.js'
import { verifyClaim, type Verdict } from './verify.js'

export type ReportClaim = Verdict & {
  id: string
  contributedBy: string[]
}

const labelForVerdict = (verdict: Run['judge']['verdict']) => {
  if (verdict === 'yes') return 'Supported'
  if (verdict === 'no') return 'Contradicted'
  if (verdict === 'mixed') return 'Mixed evidence'
  return 'Insufficient evidence'
}

const claimKey = (claim: string) => claim.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()

function verifiedClaims(run: Run): ReportClaim[] {
  const entries = new Map(run.evidence.map((entry) => [entry.path, entry.text]))
  const claims = new Map<string, ReportClaim>()

  for (const agent of run.agents) {
    if (!agent.ok) continue
    for (const claim of agent.output.claims) {
      const key = claimKey(claim.claim)
      const existing = claims.get(key)
      if (existing) {
        if (!existing.contributedBy.includes(agent.name)) existing.contributedBy.push(agent.name)
        continue
      }
      claims.set(key, {
        ...verifyClaim(claim, entries),
        id: `claim-${String(claims.size + 1).padStart(2, '0')}`,
        contributedBy: [agent.name],
      })
    }
  }

  for (const claim of run.judge.claims) {
    const key = claimKey(claim.claim)
    const existing = claims.get(key)
    if (existing) {
      if (!existing.contributedBy.includes('Judge')) existing.contributedBy.push('Judge')
      continue
    }
    claims.set(key, {
      ...verifyClaim(claim, entries),
      id: `claim-${String(claims.size + 1).padStart(2, '0')}`,
      contributedBy: ['Judge'],
    })
  }

  return [...claims.values()]
}

function agentSummary(agent: AgentResult, run: Run) {
  if (!agent.ok) {
    return {
      name: agent.name,
      ok: false as const,
      error: 'Agent did not complete this investigation.',
      summary: '',
      verified: 0,
      total: 0,
    }
  }
  const entries = new Map(run.evidence.map((entry) => [entry.path, entry.text]))
  const checked = agent.output.claims.map((claim) => verifyClaim(claim, entries))
  return {
    name: agent.name,
    ok: true as const,
    summary: agent.output.summary,
    verified: checked.filter((claim) => claim.verified).length,
    total: checked.length,
  }
}

function conflictGroups(claims: ReportClaim[]) {
  const contradictionClaims = claims.filter((claim) => claim.contributedBy.includes('Contradiction Hunter') && claim.verified)
  const groups = new Map<string, ReportClaim[]>()

  for (const claim of contradictionClaims) {
    const benchmark = claim.claim.result?.benchmark?.trim()
    if (!benchmark) continue
    const key = benchmark.toLowerCase().replace(/\s+benchmark(?: suite)?$/, '')
    groups.set(key, [...(groups.get(key) ?? []), claim])
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group, index) => {
      const benchmark = group[0].claim.result?.benchmark ?? 'Unspecified benchmark'
      const models = [...new Set(group.map((item) => item.claim.result?.model).filter(Boolean))]
      return {
        id: `comparison-${String(index + 1).padStart(2, '0')}`,
        benchmark,
        claims: group,
        explanation:
          models.length > 1
            ? `These results share a benchmark but evaluate different systems (${models.join(' and ')}). They are useful comparative evidence, but do not isolate memory representation under an otherwise identical setup.`
            : 'These results use related evidence but do not hold the model, dataset, metric, and experimental assumptions constant.',
      }
    })
}

export function buildPublicReport(run: Run) {
  const claims = verifiedClaims(run)
  const verified = claims.filter((claim) => claim.verified)
  const judgeEntries = new Map(run.evidence.map((entry) => [entry.path, entry.text]))
  const judgeClaims = run.judge.claims.map((claim) => verifyClaim(claim, judgeEntries))

  return {
    createdAt: run.createdAt,
    question: run.question,
    model: run.model,
    verdict: run.judge.verdict,
    verdictLabel: labelForVerdict(run.judge.verdict),
    reasoning: run.judge.reasoning,
    openQuestions: run.judge.openQuestions,
    counts: {
      sources: run.evidence.length,
      claims: claims.length,
      verified: verified.length,
      rejected: claims.length - verified.length,
      judgeVerified: judgeClaims.filter((claim) => claim.verified).length,
    },
    claims,
    conflicts: conflictGroups(claims),
    agents: run.agents.map((agent) => agentSummary(agent, run)),
    // Public reports contain only passages explicitly cited by the council. The full
    // knowledge-base document and its private identifier never cross the API boundary.
    sources: run.evidence.map((entry, index) => {
      const citedClaims = claims.filter((claim) => claim.sources.some((source) => source.path === entry.path))
      const passages = [
        ...new Set(
          citedClaims.flatMap((claim) =>
            claim.sources
              .filter((source) => source.path === entry.path && source.found)
              .map((source) => source.quote),
          ),
        ),
      ]
      return {
        id: `source-${String(index + 1).padStart(2, '0')}`,
        path: entry.path,
        score: entry.score,
        passages,
        citedClaims: citedClaims.map((claim) => claim.id),
      }
    }),
  }
}
