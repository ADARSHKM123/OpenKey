// Per-provider circuit breaker. A provider that just failed N times in a row
// should not receive every employee's next request while it burns — routes
// with an OPEN breaker are skipped during resolution (SPEC §5 step 2) and
// probed again by a single request after the cooldown (half-open).

const FAILURE_THRESHOLD = 3;
const OPEN_MS = 30_000;

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
  probing: boolean;
}

export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();

  private state(providerId: string): BreakerState {
    let s = this.states.get(providerId);
    if (!s) {
      s = { consecutiveFailures: 0, openedAt: null, probing: false };
      this.states.set(providerId, s);
    }
    return s;
  }

  // true = this route may be attempted right now.
  allow(providerId: string): boolean {
    const s = this.state(providerId);
    if (s.openedAt === null) return true;
    if (Date.now() - s.openedAt < OPEN_MS) return false;
    // Half-open: exactly one in-flight probe; everyone else keeps skipping.
    if (s.probing) return false;
    s.probing = true;
    return true;
  }

  recordSuccess(providerId: string): void {
    const s = this.state(providerId);
    s.consecutiveFailures = 0;
    s.openedAt = null;
    s.probing = false;
  }

  recordFailure(providerId: string): void {
    const s = this.state(providerId);
    s.consecutiveFailures++;
    s.probing = false;
    if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      s.openedAt = Date.now();
    }
  }

  isOpen(providerId: string): boolean {
    const s = this.state(providerId);
    return s.openedAt !== null && Date.now() - s.openedAt < OPEN_MS;
  }
}
