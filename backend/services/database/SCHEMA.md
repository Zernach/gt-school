# Database Schema

> [!IMPORTANT]
> pgvector is a first-class database capability, not an optional future add-on.
> Preserve `vector` extension support, model/dimension metadata, and vector-index
> strategy whenever designing search, recommendation, retrieval, or AI features.

The initial database volume enables the extension through
`init/001-enable-pgvector.sql`. Initialization SQL runs only when PostgreSQL
creates a new volume; application schema changes belong in `migrations/` and
must be safe for existing databases.

For every vector-bearing table, document and enforce:

- embedding model and exact vector dimensions (for example, `vector(1536)`)
- distance metric and query operator (`<=>`, `<->`, or `<#>`)
- index type and rationale (`hnsw` or `ivfflat`), plus its operational tradeoffs
- source content, chunk/version lineage, refresh policy, and deletion behavior

Do not silently replace vector search with JSON, text matching, or Redis data.
Keep vectors and their relational metadata in PostgreSQL unless a deliberate,
documented architecture change says otherwise.

Describe tables, relationships, constraints, indexes, and migration notes below.

PostgreSQL is intentionally available only to services in this Compose project.
For local inspection, use `../../docker/compose.sh exec postgres psql -U app -d app`
or add a host-port mapping in `../../docker/compose.local.yaml`.
