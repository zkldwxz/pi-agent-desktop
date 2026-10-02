/**
 * The shell's audio: a completion chime, and five short interaction clicks.
 *
 * Synthesised instead of shipping audio files: a couple of oscillators and a
 * noise buffer read as the same sounds and cost nothing to load. The context is
 * created lazily and reused across both; browsers refuse to start one without a
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

/* ── interaction cues ──────────────────────────────────────
 * Five short clicks for the things you press, so a control confirms itself
 * before the thing it does has had time to happen.
 *
 * Synthesized for the same reason the chime is: no asset to ship and no
 * dependency to install. The layer parameters are the reference design's — a
 * white-noise transient through a highpass against a bright sine pluck for an
 * ordinary press, a bandpassed square for anything you toggle, a lowpassed
 * clack for anything that takes something away, a rising blip for navigation,
 * and a rounder sine with body for the actions that cost something.
 */

type Cue = "press" | "tick" | "release" | "page" | "pulse";

interface Layer {
  tone?: { type: OscillatorType; frequency: number; to?: number };
  /** white noise instead of a tone — the transient half of a click */
  hiss?: boolean;
  filter?: { type: BiquadFilterType; frequency: number; q?: number };
  attack: number;
  decay: number;
  gain: number;
}

const CUES: Record<Cue, Layer[]> = {
  press: [
    { hiss: true, filter: { type: "highpass", frequency: 2400 }, attack: 0.0003, decay: 0.009, gain: 0.13 },
    { tone: { type: "sine", frequency: 680 }, attack: 0.0006, decay: 0.022, gain: 0.24 },
  ],
  tick: [
    {
      tone: { type: "square", frequency: 2100 },
      filter: { type: "bandpass", frequency: 2600, q: 1.6 },
      attack: 0.0004,
      decay: 0.028,
      gain: 0.24,
    },
  ],
  release: [
    { hiss: true, filter: { type: "lowpass", frequency: 1600, q: 0.9 }, attack: 0.001, decay: 0.055, gain: 0.32 },
  ],
  page: [{ tone: { type: "sine", frequency: 430, to: 640 }, attack: 0.002, decay: 0.11, gain: 0.4 }],
  pulse: [
    { tone: { type: "sine", frequency: 330 }, filter: { type: "lowpass", frequency: 2200 }, attack: 0.002, decay: 0.13, gain: 0.5 },
  ],
};

/** Quiet enough to sit under a conversation rather than in front of it. */
const MASTER = 0.32;
const TOGGLE_KEY = "pi-sounds";

let bus: GainNode | null = null;
let noise: AudioBuffer | null = null;

function busOf(audio: AudioContext): GainNode {
  if (!bus) {
    bus = audio.createGain();
    bus.gain.value = MASTER;
    bus.connect(audio.destination);
  }
  return bus;
}

/** One short buffer of white noise, reused by every hiss. */
function noiseOf(audio: AudioContext): AudioBuffer {
  if (!noise) {
    const length = Math.ceil(audio.sampleRate * 0.08);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) samples[i] = Math.random() * 2 - 1;
    noise = buffer;
  }
  return noise;
}

function playLayer(audio: AudioContext, at: number, layer: Layer): void {
  const amp = audio.createGain();
  const source = layer.hiss
    ? (() => {
        const src = audio.createBufferSource();
        src.buffer = noiseOf(audio);
        return src;
      })()
    : (() => {
        const osc = audio.createOscillator();
        osc.type = layer.tone?.type ?? "sine";
        osc.frequency.setValueAtTime(layer.tone?.frequency ?? 440, at);
        if (layer.tone?.to !== undefined) {
          osc.frequency.linearRampToValueAtTime(layer.tone.to, at + layer.attack + layer.decay);
        }
        return osc;
      })();

  const end = at + layer.attack + layer.decay;
  /* exponential rather than linear out, because a linear ramp to zero audibly
     stops; the tail is what makes two layers read as one click */
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(layer.gain, at + layer.attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  const tail = layer.filter
    ? (() => {
        const filter = audio.createBiquadFilter();
        filter.type = layer.filter.type;
        filter.frequency.value = layer.filter.frequency;
        if (layer.filter.q !== undefined) filter.Q.value = layer.filter.q;
        return filter;
      })()
    : null;

  source.connect(tail ?? amp);
  if (tail) tail.connect(amp);
  amp.connect(busOf(audio));
  source.start(at);
  source.stop(end + 0.02);
}

const INTERACTIVE = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
].join(",");

const DISMISS_WORDS = /close|dismiss|remove|delete|collapse|cancel|clear|关闭|删除|取消|收起/i;
const PRIMARY_WORDS = /send|save|submit|create|add|upgrade|replay|发送|保存|新建|创建/i;

/** Which click this is. The label decides before the role does, because
 *  "Delete channel" is a *release* whatever element it happens to be. */
function cueFor(control: Element): Cue {
  const override = control.getAttribute("data-sound");
  if (override && override in CUES) return override as Cue;
  const label = `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`.trim();
  if (DISMISS_WORDS.test(label)) return "release";
  if (
    control.matches(
      "input[type='checkbox'], input[type='radio'], select, [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [aria-pressed]",
    )
  ) {
    return "tick";
  }
  if (control.matches("a[href]")) return "page";
  if (PRIMARY_WORDS.test(label)) return "pulse";
  if (control.matches("input, textarea")) return "tick";
  return "press";
}

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(TOGGLE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem(TOGGLE_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the toggle just will not persist */
  }
}

/**
 * One delegated audio layer for the whole shell.
 *
 * Capture phase, so a control that stops propagation still answers. The
 * context is not touched until the first real click, which is both what
 * browsers require and what avoids a warning on every load.
 */
export function installInteractionSounds(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (!soundsEnabled()) return;
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest(INTERACTIVE);
      if (!control || control.closest("[data-sound-silent]")) return;
      if (control.matches(":disabled, [aria-disabled='true']")) return;
      const audio = context();
      if (!audio) return;
      const at = audio.currentTime + 0.004;
      for (const layer of CUES[cueFor(control)]) playLayer(audio, at, layer);
    },
    true,
  );
}
