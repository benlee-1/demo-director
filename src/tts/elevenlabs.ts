// ElevenLabs TtsProvider. Uses the /with-timestamps endpoint so the measured
// duration comes from the returned character alignment — exact, no ffprobe.
//
// Secret handling: the API key is read from ELEVENLABS_API_KEY at construction
// and held only in memory. It is never written to a file and never logged.

import { ELEVEN_MODEL } from "../config.js";
import type { SynthesisResult, SynthesizeOptions, TtsProvider } from "./provider.js";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const OUTPUT_FORMAT = "mp3_44100_128";

interface TimestampedResponse {
  audio_base64: string;
  alignment?: { character_end_times_seconds?: number[] };
  normalized_alignment?: { character_end_times_seconds?: number[] };
}

function durationFrom(r: TimestampedResponse): number {
  const ends = r.alignment?.character_end_times_seconds ?? r.normalized_alignment?.character_end_times_seconds;
  const last = ends?.at(-1);
  if (typeof last !== "number" || !Number.isFinite(last) || last <= 0) {
    throw new Error("ElevenLabs returned no usable timestamp alignment to measure duration.");
  }
  return last;
}

export class ElevenLabsProvider implements TtsProvider {
  readonly name = "elevenlabs";
  readonly #apiKey: string;

  constructor(apiKey = process.env.ELEVENLABS_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Export it (e.g. in .env) before running the VO stage — do not inline a key.",
      );
    }
    this.#apiKey = apiKey;
  }

  async synthesize(text: string, opts: SynthesizeOptions): Promise<SynthesisResult> {
    const url = `${API_BASE}/${opts.voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.#apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ text, model_id: opts.modelId ?? ELEVEN_MODEL }),
    });
    if (!res.ok) {
      // Surface status + body, but never echo the key.
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as TimestampedResponse;
    return { audio: Buffer.from(json.audio_base64, "base64"), seconds: durationFrom(json) };
  }
}
