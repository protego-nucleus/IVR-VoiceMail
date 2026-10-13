-- Voicemail-only (Pradip, 13-Oct-2026): record each recording's CallStatus so only real voicemails
-- (Unanswered / Un-opted calls) are transcribed and listed. Existing rows stay NULL — every one of
-- them was an Answered call, and they are kept, not deleted, pending an explicit decision.
ALTER TABLE "VoicemailAudio" ADD COLUMN "callStatus" TEXT;
