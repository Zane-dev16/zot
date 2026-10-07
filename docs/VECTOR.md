# Vector search

Recall order is FTS first, vector second, LIKE last.

FTS covers exact keyword match with no extra service. When FTS returns rows, the API answers from FTS. When FTS returns nothing, the API falls back to vector rank. When no embedding is stored, LIKE is the last resort.

Embeddings are local hash vectors with no vendor and no new deps. `src/memory.js` owns `embedText` plus `cosineSimilarity` plus `rankByVector`. Dim is 64. Tokens are lowercase alphanumeric spans hashed with FNV-1a into 64 buckets and L2 normalized. Cosine is a dot product over normalized vectors.

Hash vectors measure token overlap, not meaning. They catch multiword queries where FTS MATCH fails but one stored note shares most terms, for example query "how do I feed the puppy" against stored "puppy feeding guide". They do not catch true synonyms such as puppy versus dog. That limit is honest and documented here so a later upgrade to real embeddings has a clear trigger.

Write path. Fresh DBs get `memory_item.embedding` from `migrations.sql`. Existing DBs gain the column via `ensureEmbeddingColumn` and get values via `backfillEmbeddings`. New items carry an embedding from `createMemoryItem`. The API will store `serializeEmbedding` output on PUT and select candidates with `buildVectorSelect`, then rank in JS with `rankByVector`.

Verify with `node --check src/memory.js` and `node scripts/verify-vector.js`. The script proves deterministic embeddings, self cosine 1, overlap ranking, legacy backfill, and FTS plus vector both finding one row.
