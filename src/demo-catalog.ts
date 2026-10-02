export type DemoDefinition = {
  slug: string
  file: string
  sourceRun: string
  title: string
  description: string
}

export const DEMO_DEFINITIONS: DemoDefinition[] = [
  {
    slug: 'object-reidentification',
    file: 'object-reidentification.json',
    sourceRun: '2026-10-02T14-47-56-757Z.json',
    title: 'Recognizing a previously seen physical object',
    description: 'Tracking, visual re-identification, spatial context and episodic memory in wearable systems.',
  },
  {
    slug: 'episodic-video-memory',
    file: 'episodic-video-memory.json',
    sourceRun: '2026-10-02T15-13-28-288Z.json',
    title: 'Turning long videos into retrievable episodic memory',
    description: 'Published approaches for structuring and retrieving events from long-form video.',
  },
  {
    slug: 'graph-vs-caption-memory',
    file: 'graph-vs-caption-memory.json',
    sourceRun: '2026-10-02T13-31-30-221Z.json',
    title: 'Graph memory compared with caption memory',
    description: 'What the current literature can—and cannot—establish about long-term video understanding.',
  },
]
