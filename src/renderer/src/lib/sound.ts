/**
 * Completion chime.
 *
 * Synthesised instead of shipping an audio file: two short sine partials with
 * an exponential decay read as a soft "done" and cost nothing to load. The
 * context is created lazily and reused; browsers refuse to start one without a
 * user gesture, so a failure here is silent on purpose.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function note(audio: AudioContext, frequency: number, at: number, duration: number, gain: number): void {
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(amp).connect(audio.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** A five-note rising figure — a finished turn, not an alarm. */
export function playDoneChime(): void {
  const audio = context();
  if (!audio) return;
  const t = audio.currentTime + 0.01;
  note(audio, 587.33, t, 0.28, 0.075); // D5
  note(audio, 880.0, t + 0.09, 0.34, 0.06); // A5
}
