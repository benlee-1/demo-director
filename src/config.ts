// Shared pipeline constants. Nothing secret lives here — API keys come from env.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DEVICE_SCALE_FACTOR = 2; // retina screenshots; video records at WIDTH×HEIGHT

// Voiceover (ElevenLabs) — voice id approved for this reel.
export const VOICE_ID = "qyFhaJEAwHR0eYLCmlUT";
export const ELEVEN_MODEL = "eleven_multilingual_v2";

// Vision script (Claude) — most capable model, per the claude-api reference.
export const ANTHROPIC_MODEL = "claude-opus-4-8";

export const RUNS_DIR = "runs";
export const OUT_DIR = "out";
