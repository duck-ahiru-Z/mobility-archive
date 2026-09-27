import {collect} from './collector';
import type {Env} from './types';

export default {
  async fetch() {
    return new Response('Mobility Archive collector is running. Use the scheduled event.', {status: 200});
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      collect(env)
        .then(r => console.log(JSON.stringify({event: 'collection_complete', results: r})))
        .catch(e => console.error(JSON.stringify({event: 'collection_failed', error: String(e)})))
    );
  }
};
