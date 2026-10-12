-- Speech-to-text for IVR recordings (OpenAI Whisper, core/transcribe.ts). All nullable: a
-- recording without text yet is the normal state until the transcription backfill reaches it.
ALTER TABLE "VoicemailAudio" ADD COLUMN "transcript" TEXT;
ALTER TABLE "VoicemailAudio" ADD COLUMN "transcriptLang" TEXT;
ALTER TABLE "VoicemailAudio" ADD COLUMN "transcribedAt" TIMESTAMP(3);
ALTER TABLE "VoicemailAudio" ADD COLUMN "transcriptError" TEXT;
