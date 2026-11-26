import {afterEach,describe,expect,it,vi} from 'vitest';
import {collect} from '../src/collector';
import type {Env} from '../src/types';

afterEach(()=>vi.unstubAllGlobals());
describe('realtime fetch freshness policy',()=>{
  it('bypasses cache for all four realtime feeds and saves empty-feed bytes unchanged',async()=>{
    const bytes=Uint8Array.from([10,13,10,3,50,46,48,16,0,24,128,128,128,128,1]);
    const fetchMock=vi.fn(async()=>new Response(bytes,{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    const put=vi.fn(async()=>({}));
    const env={ARCHIVE_BUCKET:{put},COLLECTOR_VERSION:'test'} as unknown as Env;
    const result=await collect(env,new Date('2026-11-26T04:00:00Z'));
    expect(result).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for(const call of fetchMock.mock.calls as unknown as [string,RequestInit][]){expect(call[1].cache).toBe('no-store');}
    expect(put).toHaveBeenCalledTimes(4);
    for(const call of put.mock.calls as unknown as [string,ArrayBuffer,unknown][]){
      expect(new Uint8Array(call[1])).toEqual(bytes);
      expect(call[0]).toContain('/20261126/040000.pb');
    }
    expect(result.every(r=>r.result.status==='success')).toBe(true);
  });
  it('leaves Static GTFS fetch cache mode unspecified',async()=>{
    const fetchMock=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{status:200}));
    vi.stubGlobal('fetch',fetchMock);
    const env={ARCHIVE_BUCKET:{put:vi.fn(async()=>({})),head:vi.fn(async()=>({}))},COLLECTOR_VERSION:'test'} as unknown as Env;
    await collect(env,new Date('2026-11-26T04:00:00Z'),true);
    const calls=fetchMock.mock.calls as unknown as [string,RequestInit][];
    expect(calls).toHaveLength(6);
    for(const [url,init] of calls)expect(init.cache).toBe(url.includes('/realtime/')?'no-store':undefined);
  });
});
