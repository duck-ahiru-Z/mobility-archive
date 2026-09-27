export function sha256Hex(bytes:ArrayBuffer|Uint8Array){const data=bytes instanceof Uint8Array?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes;return crypto.subtle.digest('SHA-256',data as ArrayBuffer).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''));}
export function keyFor(sourceId:string,feed: 'vehicle-positions'|'trip-updates',d:Date,hash:string){const p=d.toISOString().replace(/[-:]/g,'').replace('T','/').replace(/\.\d{3}Z/,''); return `raw/gtfs-rt/${sourceId}/${feed}/${p}-${hash.slice(0,12)}.pb`;}
export function staticKey(sourceId:string,hash:string){return `static/${sourceId}/versions/${hash}.zip`;}
export const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export type StorageStatus='normal'|'warning'|'critical'|'emergency'|'over_free_tier';
export function storageStatus(bytes:number):StorageStatus{if(bytes>=10_000_000_000)return 'over_free_tier';if(bytes>=9_500_000_000)return 'emergency';if(bytes>=9_000_000_000)return 'critical';if(bytes>=8_000_000_000)return 'warning';return 'normal';}
