-- Raw source payloads are retained for lineage and reached through immutable
-- source-record IDs; no API query filters on arbitrary payload JSON.
DROP INDEX IF EXISTS source_records_payload_gin_idx;
