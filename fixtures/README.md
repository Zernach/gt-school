# Synthetic fixture workspace

`npm run seed -- --seed 424242` deterministically creates `fixtures/generated/` in one command. Bulk output is ignored because it is reproducible (~4 MiB); the compact grading oracles under `golden/` are committed.

The generator writes stable-key-sorted JSONL for a representative 10% slice: 4,000 CRM contacts, 1,500 CRM deals, 2,500 App students, 2,200 App enrollments, and 1,800 Payments records. Generation 1 is the base; generations 2 and 3 apply committed-shape deltas, including three values reasserted against the App view.

`manifest.json` records schema/seed, relative paths, SHA-256 hashes, generation count, record volumes, clean-entity count, three-source coverage, households, legitimate orphan leads, overlaps, reversed timestamps, malformed payloads, and reassertions. Tests enforce every Appendix A minimum and rerun generation into two temporary directories to prove byte equality.

`malformed-payments.jsonl` contains 21 deliberately invalid adapter payloads, including missing fields, wrong types, truncated JSON, and an oversized record. These are rejected evidence; they are not silently included in complete source snapshots.

Never replace generated fixtures with a production export. Every email uses reserved synthetic domains, all identities are invented, and all credentials are fixture-only. If the schema changes, update the generator, Zod source schemas, adapter reader, manifest assertions, golden contracts, and documentation as one vertical change.

Committed oracles:

- `golden/conflicts.json`: exact 305-conflict grading set;
- `golden/clean-sample.json`: 100 known-clean entity hashes; and
- `golden/entity-view.json`: a hand-checked CRM/App/Payments unified query result.
