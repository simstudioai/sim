-- Retired Search knowledge bases (is_search_index) no longer get candidate rows: a chunk write
-- there deletes the chunk's row instead of projecting it. Ordinary knowledge bases project exactly
-- as before. Replacing the function takes no table lock and replays idempotently; the
-- embedding_search_sync trigger, its WHEN guard and the source/ACL trigger are unchanged. The body
-- must stay identical to SYNC_EMBEDDING_SEARCH_FUNCTION in packages/db/knowledge-projection.ts.
CREATE OR REPLACE FUNCTION "public"."sync_embedding_search"()
  RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    search_index boolean;
    shortened boolean;
  BEGIN
    SELECT is_search_index, embedding_model IN ('text-embedding-3-small', 'text-embedding-3-large') AND NEW.embedding_384 IS NULL
      INTO STRICT search_index, shortened
    FROM knowledge_base WHERE id = NEW.knowledge_base_id;
    IF search_index THEN
      DELETE FROM embedding_search WHERE id = NEW.id;
      RETURN NEW;
    END IF;
    INSERT INTO embedding_search
      (id, knowledge_base_id, document_id, enabled, "binary", binary_384, binary_768, binary_1024, binary_3072,
        vector, vector_384, vector_512, vector_768, vector_1024, vector_3072)
    VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled,
      binary_quantize(NEW.embedding)::bit(1536), binary_quantize(NEW.embedding_384)::bit(384),
      binary_quantize(NEW.embedding_768)::bit(768), binary_quantize(NEW.embedding_1024)::bit(1024),
      binary_quantize(NEW.embedding_3072)::bit(3072),
      CASE WHEN NOT (shortened) THEN NEW.embedding::halfvec(1536) END,
      CASE WHEN NOT (shortened) THEN NEW.embedding_384::halfvec(384) END,
      CASE WHEN shortened THEN subvector(coalesce(NEW.embedding, NEW.embedding_384, NEW.embedding_768, NEW.embedding_1024, NEW.embedding_3072), 1, 512)::halfvec(512) END,
      CASE WHEN NOT (shortened) THEN NEW.embedding_768::halfvec(768) END,
      CASE WHEN NOT (shortened) THEN NEW.embedding_1024::halfvec(1024) END,
      CASE WHEN NOT (shortened) THEN NEW.embedding_3072::halfvec(3072) END)
    ON CONFLICT (id) DO UPDATE SET
      knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
      enabled = EXCLUDED.enabled, "binary" = EXCLUDED."binary", binary_384 = EXCLUDED.binary_384,
      binary_768 = EXCLUDED.binary_768, binary_1024 = EXCLUDED.binary_1024,
      binary_3072 = EXCLUDED.binary_3072,
      vector = EXCLUDED.vector, vector_384 = EXCLUDED.vector_384, vector_512 = EXCLUDED.vector_512,
      vector_768 = EXCLUDED.vector_768, vector_1024 = EXCLUDED.vector_1024, vector_3072 = EXCLUDED.vector_3072;
    RETURN NEW;
  END;
  $$;
