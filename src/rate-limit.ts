export type LimitDecision = {
  allowed: boolean
  remaining: number
}

export interface LiveInvestigationLimiter {
  consume(key: string): LimitDecision
  release(key: string): void
  remaining(key: string): number
}

type SessionUsage = { used: number; touchedAt: number }

/**
 * A deliberately small first-line limiter. Its interface keeps policy out of the
 * HTTP handler so a durable IP/user-based implementation can replace it later.
 */
export class InMemorySessionLimiter implements LiveInvestigationLimiter {
  private readonly usage = new Map<string, SessionUsage>()

  constructor(
    private readonly limit = 1,
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
  ) {}

  consume(key: string): LimitDecision {
    this.prune()
    const current = this.usage.get(key) ?? { used: 0, touchedAt: Date.now() }
    current.touchedAt = Date.now()
    if (current.used >= this.limit) {
      this.usage.set(key, current)
      return { allowed: false, remaining: 0 }
    }
    current.used += 1
    this.usage.set(key, current)
    return { allowed: true, remaining: Math.max(0, this.limit - current.used) }
  }

  release(key: string) {
    const current = this.usage.get(key)
    if (!current) return
    current.used = Math.max(0, current.used - 1)
    current.touchedAt = Date.now()
    if (current.used === 0) this.usage.delete(key)
  }

  remaining(key: string) {
    this.prune()
    return Math.max(0, this.limit - (this.usage.get(key)?.used ?? 0))
  }

  private prune() {
    const expiredBefore = Date.now() - this.ttlMs
    for (const [key, value] of this.usage) {
      if (value.touchedAt < expiredBefore) this.usage.delete(key)
    }
  }
}
