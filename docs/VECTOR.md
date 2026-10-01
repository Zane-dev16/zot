# Vector search note (draft)

Current state uses SQLite FTS5 for text search.

FTS covers keyword match today. It needs no extra service. It keeps the build simple.

Embeddings come later. They will cover semantic match. Candidate path is a local vector column plus cosine query. No vendor is selected yet.

Upgrade trigger is real user misses where keywords fail but meaning matches. Until then FTS stays.
