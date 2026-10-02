// Collects evidence for a question in plain code: keyword searches + reads over MCP, no LLM involved.

export type Entry = { path: string; score: number; text: string }

type McpTool = { execute?: (input: any, options: any) => unknown }
type ToolResult = { isError?: boolean; content?: { type: string; text?: string }[] }

const STOPWORDS = new Set(
  ('a an and are as at be behind but by cite does do every exact for from how in into is it its long more of on or ' +
    'number numbers outperform over simple source sources than that the their this to vs what when which who why with').split(' '),
)

export function keywords(question: string): string[] {
  const words = question.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
  return [...new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)))]
}

async function call(tool: McpTool, input: unknown): Promise<string> {
  if (!tool.execute) throw new Error('MCP tool has no execute function')
  const res = (await tool.execute(input, { toolCallId: 'evidence', messages: [] })) as ToolResult
  const text = res.content?.map((c) => c.text ?? '').join('\n') ?? ''
  if (res.isError) throw new Error(text || 'MCP tool error')
  return text
}

export async function collectEvidence(
  tools: Record<string, McpTool>,
  knowledgeBase: string,
  question: string,
  { maxEntries = 5, log = console.log } = {},
): Promise<Entry[]> {
  const { knowledge_base_search: search, knowledge_base_read: read } = tools
  if (!search || !read) throw new Error('Endpoint does not serve knowledge_base_search and knowledge_base_read')
  const terms = keywords(question)
  // One search with all keywords, plus one per keyword so rarer terms still surface entries.
  const queries = [terms.join(' '), ...terms]
  const scores = new Map<string, number>()

  await Promise.all(
    queries.map(async (query) => {
      const text = await call(search, { knowledgeBase, query, limit: 5 })
      const hits = [...text.matchAll(/`([^`]+)` \(score ([\d.]+)\)/g)]
      for (const [, path, score] of hits) scores.set(path, (scores.get(path) ?? 0) + Number(score))
      log(`    search "${query}" → ${hits.length} hits`)
    }),
  )

  const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxEntries)
  return Promise.all(
    top.map(async ([path, score]) => {
      const text = await call(read, { knowledgeBase, paths: [path] })
      log(`    read ${path} (score ${score.toFixed(1)}, ${text.length} chars)`)
      return { path, score, text }
    }),
  )
}
