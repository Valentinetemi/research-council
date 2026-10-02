// Deterministic claim verifier: no LLM involved. Checks each quote against the entry text
// fetched directly from the knowledge base, and each number in the claim against its quotes.

export type Source = { path: string; quote: string }
export type Claim = {
  claim: string
  sources: Source[]
  result?: { benchmark?: string; dataset?: string; model?: string; metric?: string }
}

export type SourceCheck = { path: string; quote: string; found: boolean; reason?: string }
export type Verdict = {
  claim: Claim
  verified: boolean
  sources: SourceCheck[]
  numbers: string[]
  missingNumbers: string[]
  reasons: string[]
}

// Normalize formatting that differs between markdown entries and quoted prose, without changing wording:
// markdown emphasis/code marks, [n] citation markers, smart quotes, dash variants, whitespace and case.
export function normalize(text: string): string {
  return text
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:%)])/g, '$1')
    .trim()
    .toLowerCase()
}

const canonical = (n: string) => n.replace(/,/g, '')

// Numbers stated in a claim. Skips digits glued to letters (model names like GPT-4o, Qwen2.5-VL, 7B)
// and citation markers, so only quantities the claim asserts are checked.
export function claimNumbers(text: string): string[] {
  const cleaned = text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
  const matches = cleaned.match(/(?<![\p{L}\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\p{L}\d])|(?<![\p{L}\d.,])\d+(?:\.\d+)?(?![\p{L}\d])/gu) ?? []
  return [...new Set(matches.map(canonical))]
}

// Every number appearing anywhere in a quote (inclusive, so "Qwen2.5" contributes 2.5).
function quoteNumbers(text: string): Set<string> {
  const matches = text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []
  return new Set(matches.map(canonical))
}

export function verifyClaim(claim: Claim, entries: Map<string, string | null>): Verdict {
  const reasons: string[] = []
  const sources: SourceCheck[] = claim.sources.map(({ path, quote }) => {
    const entry = entries.get(path)
    if (entry == null) return { path, quote, found: false, reason: `entry "${path}" was not in the evidence given to the agents` }
    if (!quote.trim()) return { path, quote, found: false, reason: `empty quote for "${path}"` }
    if (!normalize(entry).includes(normalize(quote))) {
      return { path, quote, found: false, reason: `quote not found in entry "${path}"` }
    }
    return { path, quote, found: true }
  })

  if (sources.length === 0) reasons.push('claim cites no sources')
  for (const s of sources) if (!s.found) reasons.push(s.reason!)

  // Numbers must be backed by a quote that was actually found in its entry.
  const numbers = claimNumbers(claim.claim)
  const backed = new Set<string>()
  for (const s of sources) if (s.found) for (const n of quoteNumbers(s.quote)) backed.add(n)
  const missingNumbers = numbers.filter((n) => !backed.has(n))
  for (const n of missingNumbers) reasons.push(`number ${n} in the claim does not appear in any verified quote`)

  return { claim, verified: reasons.length === 0, sources, numbers, missingNumbers, reasons }
}

// Numbers in free text (e.g. the judge's reasoning) that no verified claim's quote backs up.
export function unbackedNumbers(text: string, verdicts: Verdict[]): string[] {
  const backed = new Set<string>()
  for (const v of verdicts) if (v.verified) for (const s of v.sources) for (const n of quoteNumbers(s.quote)) backed.add(n)
  return claimNumbers(text).filter((n) => !backed.has(n))
}
