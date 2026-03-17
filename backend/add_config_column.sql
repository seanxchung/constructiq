-- Add config column to projects table for storing configure-tab state.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query).
-- Safe to run multiple times — the IF NOT EXISTS prevents duplicates.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'config'
  ) THEN
    ALTER TABLE projects ADD COLUMN config jsonb DEFAULT NULL;
  END IF;
END $$;
