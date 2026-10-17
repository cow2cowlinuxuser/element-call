/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type AudioProcessorOptions,
  type LocalAudioTrack,
  type Track,
  type TrackProcessor,
} from "livekit-client";
import {
  BehaviorSubject,
  combineLatest,
  type Observable,
  of,
  type Subscription,
} from "rxjs";
import { type Logger, logger as rootLogger } from "matrix-js-sdk/lib/logger";

import micGateWorkletUrl from "./micGate.worklet.js?url&no-inline";
import {
  createEqualiser,
  defaultEqualiserTuning,
  type EqualiserTuning,
  equaliserHeadroom,
  rampTo,
  tuneEqualiser,
} from "./PeerAudioChain";
import { type Behavior } from "../state/Behavior";
import { type MicProcessing } from "../state/MicProcessing";

const getLogger = (): Logger => rootLogger.getChild("[MicProcessor]");

export const MIC_GATE_PROCESSOR = "element-call-mic-gate";

/**
 * The inner workings of the chain, which the user does not set. Kept apart so
 * that they can be refined in the audio lab (see `audio-lab/`).
 */
export interface MicTuning {
  /** Below the lowest voices: desk bumps, fans and handling noise. */
  rumbleCutoffHz: number;
  noiseReduction: {
    /**
     * How much of the unprocessed sound to mix back in under RNNoise, so that
     * noise is turned down to this level rather than cut; -100 mixes none.
     */
    floorDb: number;
    /** How late RNNoise's output is, so that the mix lines up with it. */
    delaySeconds: number;
  };
  equaliser: EqualiserTuning;
  /** Whether to turn the level down by the equaliser's largest boost. */
  headroom: boolean;
  limiter: {
    thresholdDb: number;
    kneeDb: number;
    ratio: number;
    attackSeconds: number;
    releaseSeconds: number;
  };
  gate: {
    /** How long the gate stays open once the voice drops. */
    holdSeconds: number;
    attackSeconds: number;
    releaseSeconds: number;
    /** How far under the threshold an open gate lets the voice dip. */
    hysteresisDb: number;
    /** The level a closed gate turns the sound down to; -100 is silence. */
    floorDb: number;
  };
}

export const defaultMicTuning: MicTuning = {
  rumbleCutoffHz: 159,
  noiseReduction: {
    floorDb: -13,
    // Lined up by ear; RNNoise's frame and the worklet's buffering alone come
    // to 992 samples
    delaySeconds: 2054 / 48000,
  },
  equaliser: {
    bassHz: 300,
    midHz: 2390,
    midQ: 1.35,
    trebleHz: 4000,
  },
  headroom: false,
  limiter: {
    thresholdDb: -6,
    kneeDb: 0,
    ratio: 20,
    attackSeconds: 0.003,
    releaseSeconds: 0.1,
  },
  gate: {
    holdSeconds: 0.3,
    attackSeconds: 0.0105,
    releaseSeconds: 0.36,
    hysteresisDb: 6,
    floorDb: -25,
  },
};

export interface MicLevel {
  /** Input level in dBFS. */
  level: number;
  /** Whether the noise gate lets the voice through. */
  open: boolean;
}

export interface MicProcessorUnavailable {
  noiseReduction: boolean;
  gate: boolean;
}

type NoiseReductionNode = AudioWorkletNode & { destroy(): void };

export interface MicProcessorDependencies {
  createContext: () => AudioContext;
  createNoiseReduction: (context: AudioContext) => Promise<NoiseReductionNode>;
}

const defaultDependencies: MicProcessorDependencies = {
  // RNNoise works at 48 kHz only, whatever rate the hardware prefers
  createContext: () =>
    new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }),
  createNoiseReduction: async (context) =>
    (await import("./noiseReduction")).createNoiseReduction(context),
};

interface Graph {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  highpass: BiquadFilterNode;
  noiseReduction?: NoiseReductionNode;
  noiseReductionLoading: boolean;
  /** The unprocessed sound mixed in under RNNoise's. */
  dryDelay: DelayNode;
  dryGain: GainNode;
  /** Where RNNoise's output and the unprocessed sound meet. */
  mix: GainNode;
  headroom: GainNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  limiter: DynamicsCompressorNode;
  gate?: AudioWorkletNode;
  output: MediaStreamAudioDestinationNode;
  monitor: GainNode;
}

const activeMicProcessor = new BehaviorSubject<MicProcessor | null>(null);
/** The processor currently shaping the microphone, if any. */
export const activeMicProcessor$: Behavior<MicProcessor | null> =
  activeMicProcessor;

/**
 * Whether something is showing the microphone level, which needs the processor
 * to run even when the user has asked for no processing.
 */
export const micLevelWanted$ = new BehaviorSubject(false);

/**
 * Shapes the microphone before it is sent: a rumble filter, then optional
 * RNNoise noise reduction, a three band equaliser, a limiter and a noise gate.
 * The chain runs in a context of its own, so that it can run at RNNoise's
 * sample rate.
 */
export class MicProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  public readonly name = "element-call-microphone";
  public processedTrack?: MediaStreamTrack;

  private readonly level = new BehaviorSubject<MicLevel | null>(null);
  public readonly level$: Behavior<MicLevel | null> = this.level;
  private readonly monitoring = new BehaviorSubject(false);
  /** Whether the user hears their own processed voice. */
  public readonly monitoring$: Behavior<boolean> = this.monitoring;
  private readonly unavailable = new BehaviorSubject<MicProcessorUnavailable>({
    noiseReduction: false,
    gate: false,
  });
  /** The stages that failed to start, for example for lack of AudioWorklet. */
  public readonly unavailable$: Behavior<MicProcessorUnavailable> =
    this.unavailable;

  private graph?: Graph;
  private settings?: MicProcessing;
  private tuning?: MicTuning;
  private subscription?: Subscription;

  public constructor(
    private readonly settings$: Observable<MicProcessing>,
    private readonly dependencies = defaultDependencies,
    private readonly tuning$: Observable<MicTuning> = of(defaultMicTuning),
  ) {}

  /** How far the limiter is turning the voice down right now, in dB. */
  public get limiterReduction(): number {
    return this.graph?.limiter.reduction ?? 0;
  }

  public async init({ track }: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    const context = this.dependencies.createContext();
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    const monitor = context.createGain();
    monitor.gain.value = this.monitoring.value ? 1 : 0;
    monitor.connect(context.destination);
    const graph: Graph = {
      context,
      source: context.createMediaStreamSource(new MediaStream([track])),
      highpass,
      noiseReductionLoading: false,
      dryDelay: context.createDelay(0.1),
      dryGain: context.createGain(),
      mix: context.createGain(),
      headroom: context.createGain(),
      ...createEqualiser(context, defaultEqualiserTuning),
      limiter: context.createDynamicsCompressor(),
      output: context.createMediaStreamDestination(),
      monitor,
    };
    this.graph = graph;
    graph.source.connect(highpass);
    this.rewire(graph);
    this.processedTrack = graph.output.stream.getAudioTracks()[0];
    this.subscription = combineLatest([this.settings$, this.tuning$]).subscribe(
      ([settings, tuning]) => this.apply(graph, settings, tuning),
    );
    if (context.state === "suspended") {
      context.resume().catch((e) => getLogger().warn("Could not resume", e));
    }
    activeMicProcessor.next(this);

    const gate = await this.createGate(context);
    if (this.graph !== graph) return;
    graph.gate = gate;
    this.rewire(graph);
    if (this.settings && this.tuning)
      this.apply(graph, this.settings, this.tuning);
  }

  public async restart({ track }: AudioProcessorOptions): Promise<void> {
    const graph = this.graph;
    if (!graph) return;
    graph.source.disconnect();
    graph.source = graph.context.createMediaStreamSource(
      new MediaStream([track]),
    );
    graph.source.connect(graph.highpass);
    return Promise.resolve();
  }

  public async destroy(): Promise<void> {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    const graph = this.graph;
    this.graph = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.level.next(null);
    if (activeMicProcessor.value === this) activeMicProcessor.next(null);
    if (graph) {
      graph.noiseReduction?.destroy();
      if (graph.gate) graph.gate.port.onmessage = null;
      await graph.context.close().catch((e) => {
        getLogger().warn("Could not close the audio context", e);
      });
    }
  }

  public setMonitoring(monitoring: boolean): void {
    this.monitoring.next(monitoring);
    if (this.graph) this.graph.monitor.gain.value = monitoring ? 1 : 0;
  }

  private apply(
    graph: Graph,
    settings: MicProcessing,
    tuning: MicTuning,
  ): void {
    this.settings = settings;
    this.tuning = tuning;
    const now = graph.context.currentTime;

    graph.highpass.frequency.value = tuning.rumbleCutoffHz;
    graph.dryDelay.delayTime.value = tuning.noiseReduction.delaySeconds;
    rampTo(
      graph.dryGain.gain,
      gainFromFloor(tuning.noiseReduction.floorDb),
      now,
    );
    tuneEqualiser(graph, tuning.equaliser);
    const { limiter } = graph;
    limiter.threshold.value = tuning.limiter.thresholdDb;
    limiter.knee.value = tuning.limiter.kneeDb;
    limiter.ratio.value = tuning.limiter.ratio;
    limiter.attack.value = tuning.limiter.attackSeconds;
    limiter.release.value = tuning.limiter.releaseSeconds;

    rampTo(
      graph.headroom.gain,
      tuning.headroom ? equaliserHeadroom(settings) : 1,
      now,
    );
    rampTo(graph.bass.gain, settings.bass, now);
    rampTo(graph.mid.gain, settings.mid, now);
    rampTo(graph.treble.gain, settings.treble, now);

    if (graph.gate) {
      const param = (name: string): AudioParam =>
        graph.gate!.parameters.get(name)!;
      param("threshold").value = settings.gateThreshold;
      param("enabled").value = settings.gate ? 1 : 0;
      param("hold").value = tuning.gate.holdSeconds;
      param("attack").value = tuning.gate.attackSeconds;
      param("release").value = tuning.gate.releaseSeconds;
      param("hysteresis").value = tuning.gate.hysteresisDb;
      param("floor").value = tuning.gate.floorDb;
    }

    if (settings.noiseReduction) {
      if (!graph.noiseReduction && !graph.noiseReductionLoading) {
        void this.startNoiseReduction(graph);
      }
    } else if (graph.noiseReduction) {
      graph.noiseReduction.destroy();
      graph.noiseReduction = undefined;
      this.rewire(graph);
    }
  }

  private async startNoiseReduction(graph: Graph): Promise<void> {
    graph.noiseReductionLoading = true;
    let node: NoiseReductionNode;
    try {
      node = await this.dependencies.createNoiseReduction(graph.context);
    } catch (e) {
      getLogger().warn("Noise reduction is unavailable", e);
      this.unavailable.next({
        ...this.unavailable.value,
        noiseReduction: true,
      });
      return;
    } finally {
      graph.noiseReductionLoading = false;
    }
    if (this.graph !== graph || !this.settings?.noiseReduction) {
      node.destroy();
      return;
    }
    this.unavailable.next({ ...this.unavailable.value, noiseReduction: false });
    graph.noiseReduction = node;
    this.rewire(graph);
  }

  private async createGate(
    context: AudioContext,
  ): Promise<AudioWorkletNode | undefined> {
    try {
      await context.audioWorklet.addModule(micGateWorkletUrl);
      const gate = new AudioWorkletNode(context, MIC_GATE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      gate.port.onmessage = (e: MessageEvent<MicLevel>): void =>
        this.level.next(e.data);
      return gate;
    } catch (e) {
      getLogger().warn("The noise gate is unavailable", e);
      this.unavailable.next({ ...this.unavailable.value, gate: true });
      return undefined;
    }
  }

  private rewire(graph: Graph): void {
    const { highpass, noiseReduction, dryDelay, dryGain, mix } = graph;
    for (const node of [highpass, noiseReduction, dryDelay, dryGain, mix]) {
      node?.disconnect();
    }
    if (noiseReduction) {
      highpass.connect(noiseReduction);
      noiseReduction.connect(mix);
      highpass.connect(dryDelay);
      dryDelay.connect(dryGain);
      dryGain.connect(mix);
    }
    const chain: AudioNode[] = [
      noiseReduction ? mix : highpass,
      graph.headroom,
      graph.bass,
      graph.mid,
      graph.treble,
      graph.limiter,
      graph.gate,
    ].filter((node) => node !== undefined);
    for (const node of chain.slice(1)) node.disconnect();
    for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i]);
    const last = chain[chain.length - 1];
    last.connect(graph.output);
    last.connect(graph.monitor);
  }
}

function gainFromFloor(floorDb: number): number {
  return floorDb <= -100 ? 0 : 10 ** (floorDb / 20);
}

/**
 * Attaches or detaches the processor so that the track matches the desired
 * state, without throwing.
 */
export function applyMicProcessor(
  track: LocalAudioTrack,
  processor: MicProcessor | undefined,
): void {
  const current = track.getProcessor();
  if (processor && current !== processor) {
    if (track.mediaStreamTrack.readyState === "ended") return;
    track.setProcessor(processor).catch((e) => {
      getLogger().warn("Failed to attach the microphone processor", e);
    });
  } else if (!processor && current) {
    track.stopProcessor().catch((e) => {
      getLogger().warn("Failed to stop the microphone processor", e);
    });
  }
}

/**
 * Turns the browser's noise suppression on or off for a running microphone.
 * Browsers that cannot change it in place get the track restarted.
 */
export async function syncBrowserNoiseSuppression(
  track: LocalAudioTrack,
  wanted: boolean,
): Promise<void> {
  const current = track.mediaStreamTrack.getSettings().noiseSuppression;
  if (current === undefined || current === wanted) return;
  await track.applyConstraints({ noiseSuppression: wanted });
  if (track.mediaStreamTrack.getSettings().noiseSuppression !== wanted) {
    await track.restartTrack();
  }
}
