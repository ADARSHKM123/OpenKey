import { Redis } from "ioredis";

// Two connections by design: a subscriber connection enters subscribe mode
// and can no longer issue commands, so config invalidation gets its own.
export function createRedis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true, // batches concurrent hot-path commands into one RTT
  });
}

export function createRedisSubscriber(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

// Channel every gateway node subscribes to; control-plane writes publish here.
export const CFG_INVALIDATE_CHANNEL = "cfg:invalidate";
