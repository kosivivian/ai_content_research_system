-- Required extensions
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, for source_materials.embedding
