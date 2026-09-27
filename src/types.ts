export type FeedType='vehicle-positions'|'trip-updates'|'static-gtfs';
export type FeedConfig={static_gtfs:string;vehicle_positions:string;trip_updates:string};
export type Source={id:string;name:string;operator_id:string;country:string;region:string;mode:string;format:'gtfs';license:string;attribution:string;enabled:boolean;archive_raw:boolean;publish_daily_dataset:boolean;source_url:string;terms_url:string;feeds:FeedConfig};
export interface Env { ARCHIVE_BUCKET:R2Bucket; COLLECTOR_VERSION:string; MANUAL_TRIGGER_TOKEN?:string; MAX_MONTHLY_RAW_BYTES?:string }
