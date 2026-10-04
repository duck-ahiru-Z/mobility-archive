import {collect,shouldCollectStatic} from './collector';
import type {Env} from './types';

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/__run' && env.MANUAL_TRIGGER_TOKEN && request.headers.get('x-collector-token') === env.MANUAL_TRIGGER_TOKEN) {
      const results = await collect(env,new Date(),true);
      return Response.json({ok: true, results});
    }
    return new Response('Mobility Archive collector is running. Use the scheduled event.', {status: 200});
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const scheduledAt = scheduledCollectionTime(event);
    ctx.waitUntil(
      collect(env,scheduledAt,shouldCollectStatic(scheduledAt))
        .then(r => console.log(JSON.stringify({event: 'collection_complete', results: r})))
        .catch(e => console.error(JSON.stringify({event: 'collection_failed', error: String(e)})))
    );
  }
};

export function scheduledCollectionTime(event: Pick<ScheduledEvent, 'scheduledTime'>): Date {
  return new Date(event.scheduledTime);
}
