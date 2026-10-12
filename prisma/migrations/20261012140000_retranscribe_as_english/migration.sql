-- Redo every transcript as an English translation (Whisper translate mode), per Pradip
-- 12-Oct-2026: Gujarati transcripts were unreadable and Hindi came back in Devanagari. Clearing
-- them lets the startup backfill produce English text for all. Audio is untouched.
UPDATE "VoicemailAudio"
SET "transcript" = NULL, "transcriptLang" = NULL, "transcribedAt" = NULL, "transcriptError" = NULL
WHERE "transcribedAt" IS NOT NULL;
