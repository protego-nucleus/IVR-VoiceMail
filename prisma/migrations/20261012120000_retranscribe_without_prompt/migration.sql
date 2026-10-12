-- Redo every transcript made so far (12-Oct-2026): they were produced with a context prompt that
-- Whisper copied into 30 of the first 54 transcripts and that biased Hindi calls toward English.
-- Clearing them lets the startup backfill transcribe them again, prompt-free. Audio is untouched.
UPDATE "VoicemailAudio"
SET "transcript" = NULL, "transcriptLang" = NULL, "transcribedAt" = NULL, "transcriptError" = NULL
WHERE "transcribedAt" IS NOT NULL;
