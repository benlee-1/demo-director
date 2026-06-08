// TtsProvider interface — the swappable seam (PRD §5). v0 ships one impl
// (ElevenLabs), but everything downstream depends only on this contract:
// text in -> audio bytes + measured duration out. Duration is the master-
// timeline unit, so a provider MUST return a real measured length.

export interface SynthesizeOptions {
  voiceId: string;
  modelId?: string;
}

export interface SynthesisResult {
  audio: Buffer; // mp3 bytes
  seconds: number; // measured spoken duration
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, opts: SynthesizeOptions): Promise<SynthesisResult>;
}
