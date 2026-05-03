import type { MessageEvent } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable } from 'rxjs';

const CHANNEL_PREFIX = 'wabantu:inbox:';

export function inboxRedisChannel(tenantId: string): string {
  return `${CHANNEL_PREFIX}${tenantId}`;
}

/** Fire-and-forget notify after inbound WhatsApp message is persisted. */
export function publishInboxActivity(redis: Redis, tenantId: string): void {
  const payload = JSON.stringify({
    type: 'inbox',
    at: Date.now(),
  });
  void redis.publish(inboxRedisChannel(tenantId), payload).catch(() => undefined);
}

/**
 * SSE-friendly stream: Redis pub/sub for this tenant + periodic ping so proxies
 * don’t close idle connections.
 */
export function inboxActivityStream(
  redis: Redis,
  tenantId: string,
): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    const sub = redis.duplicate();
    const channel = inboxRedisChannel(tenantId);
    const onMessage = (ch: string, message: string) => {
      if (ch === channel) {
        subscriber.next({ data: message });
      }
    };
    sub.on('message', onMessage);
    const ping = setInterval(() => {
      subscriber.next({
        data: JSON.stringify({ type: 'ping' }),
      });
    }, 25_000);
    sub
      .subscribe(channel)
      .then(() => undefined)
      .catch((err: Error) => subscriber.error(err));
    return () => {
      clearInterval(ping);
      sub.off('message', onMessage);
      void sub.unsubscribe(channel).catch(() => undefined);
      sub.disconnect();
    };
  });
}
