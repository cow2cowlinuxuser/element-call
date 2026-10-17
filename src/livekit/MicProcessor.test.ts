/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  test,
  vi,
} from "vitest";
import { BehaviorSubject } from "rxjs";
import { type LocalAudioTrack, Track } from "livekit-client";

import {
  activeMicProcessor$,
  applyMicProcessor,
  defaultMicTuning,
  MIC_GATE_PROCESSOR,
  MicProcessor,
  type MicProcessorDependencies,
  type MicTuning,
  syncBrowserNoiseSuppression,
} from "./MicProcessor";
import {
  defaultMicProcessing,
  type MicProcessing,
} from "../state/MicProcessing";
import { fakeAudioParam, flushPromises } from "../utils/test";

class FakeNode {
  public connections: unknown[] = [];
  public connect = vi.fn((node: unknown) => {
    this.connections.push(node);
    return node;
  });
  public disconnect = vi.fn(() => {
    this.connections = [];
  });
}

class FakeGate extends FakeNode {
  public port: { onmessage: ((e: { data: unknown }) => void) | null } = {
    onmessage: null,
  };
  public parameters = new Map([
    ["threshold", { value: -50 }],
    ["enabled", { value: 0 }],
    ["hold", { value: 0.2 }],
    ["attack", { value: 0.005 }],
    ["release", { value: 0.08 }],
    ["hysteresis", { value: 6 }],
    ["floor", { value: -24 }],
  ]);
  public constructor(
    _context: unknown,
    public readonly processorName: string,
  ) {
    super();
  }
}

class FakeMediaStream {
  public constructor(public readonly tracks: MediaStreamTrack[]) {}
}

interface FakeContext {
  context: AudioContext;
  destination: FakeNode;
  output: FakeNode;
  outputTrack: { stop: ReturnType<typeof vi.fn> };
  sources: (FakeNode & { stream: FakeMediaStream })[];
  addModule: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function fakeContext(): FakeContext {
  const destination = new FakeNode();
  const outputTrack = { stop: vi.fn() };
  const output = Object.assign(new FakeNode(), {
    stream: { getAudioTracks: () => [outputTrack] },
  });
  const sources: FakeContext["sources"] = [];
  const addModule = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const context = {
    state: "running",
    currentTime: 0,
    destination,
    audioWorklet: { addModule },
    close,
    resume: vi.fn().mockResolvedValue(undefined),
    createBiquadFilter: () =>
      Object.assign(new FakeNode(), {
        type: "peaking",
        frequency: { value: 350 },
        Q: { value: 1 },
        gain: fakeAudioParam(0),
      }),
    createGain: () =>
      Object.assign(new FakeNode(), { gain: fakeAudioParam(1) }),
    createDelay: () =>
      Object.assign(new FakeNode(), { kind: "delay", delayTime: { value: 0 } }),
    createDynamicsCompressor: () =>
      Object.assign(new FakeNode(), {
        kind: "compressor",
        threshold: { value: -24 },
        knee: { value: 30 },
        ratio: { value: 12 },
        attack: { value: 0.003 },
        release: { value: 0.25 },
        reduction: -4,
      }),
    createMediaStreamSource: (stream: FakeMediaStream) => {
      const source = Object.assign(new FakeNode(), { stream });
      sources.push(source);
      return source;
    },
    createMediaStreamDestination: () => output,
  } as unknown as AudioContext;
  return {
    context,
    destination,
    output,
    outputTrack,
    sources,
    addModule,
    close,
  };
}

/** The nodes between the newest source and the output, in order. */
function chain(fake: FakeContext): unknown[] {
  const nodes: unknown[] = [];
  let node = fake.sources[fake.sources.length - 1].connections[0] as
    | FakeNode
    | undefined;
  while (node && node !== fake.output) {
    nodes.push(node);
    node = node.connections[0] as FakeNode | undefined;
  }
  return nodes;
}

const micTrack = { id: "mic" } as unknown as MediaStreamTrack;

describe("MicProcessor", () => {
  let fake: FakeContext;
  let settings$: BehaviorSubject<MicProcessing>;
  let noiseReduction: FakeNode & { destroy: ReturnType<typeof vi.fn> };
  let createNoiseReduction: Mock<
    MicProcessorDependencies["createNoiseReduction"]
  >;
  let tuning$: BehaviorSubject<MicTuning>;
  let processor: MicProcessor;

  beforeEach(() => {
    tuning$ = new BehaviorSubject(defaultMicTuning);
    vi.stubGlobal("AudioWorkletNode", FakeGate);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    fake = fakeContext();
    settings$ = new BehaviorSubject(defaultMicProcessing);
    noiseReduction = Object.assign(new FakeNode(), { destroy: vi.fn() });
    createNoiseReduction = vi
      .fn<MicProcessorDependencies["createNoiseReduction"]>()
      .mockResolvedValue(
        noiseReduction as unknown as AudioWorkletNode & { destroy(): void },
      );
    processor = new MicProcessor(
      settings$,
      { createContext: () => fake.context, createNoiseReduction },
      tuning$,
    );
  });

  afterEach(async () => {
    await processor.destroy();
    vi.unstubAllGlobals();
  });

  async function init(): Promise<void> {
    await processor.init({
      kind: Track.Kind.Audio,
      track: micTrack,
      audioContext: {} as AudioContext,
    });
  }

  it("sends the microphone through a rumble filter, equaliser, limiter and gate", async () => {
    await init();

    expect(processor.processedTrack).toBe(fake.outputTrack);
    expect(fake.sources[0].stream.tracks).toEqual([micTrack]);
    const [highpass, headroom, bass, mid, treble, limiter, gate, ...rest] =
      chain(fake);
    expect(rest).toEqual([]);
    expect(highpass).toMatchObject({
      type: "highpass",
      frequency: { value: defaultMicTuning.rumbleCutoffHz },
    });
    expect(headroom).toMatchObject({ gain: { value: 1 } });
    expect(limiter).toMatchObject({
      kind: "compressor",
      threshold: { value: defaultMicTuning.limiter.thresholdDb },
      knee: { value: 0 },
      ratio: { value: 20 },
    });
    expect(bass).toMatchObject({ type: "lowshelf" });
    expect(mid).toMatchObject({ type: "peaking" });
    expect(treble).toMatchObject({ type: "highshelf" });
    expect(gate).toMatchObject({ processorName: MIC_GATE_PROCESSOR });
    expect((gate as FakeNode).connections).toHaveLength(2);
  });

  it("applies the user's equaliser and gate settings", async () => {
    await init();
    tuning$.next({ ...defaultMicTuning, headroom: true });
    settings$.next({
      ...defaultMicProcessing,
      gate: true,
      gateThreshold: -40,
      bass: 3,
      mid: -2,
      treble: 5,
    });

    const [, headroom, bass, mid, treble, , gate] = chain(fake) as [
      unknown,
      GainNode,
      BiquadFilterNode,
      BiquadFilterNode,
      BiquadFilterNode,
      unknown,
      FakeGate,
    ];
    expect(headroom.gain.value).toBeCloseTo(10 ** (-5 / 20));
    expect(bass.gain.value).toBe(3);
    expect(mid.gain.value).toBe(-2);
    expect(treble.gain.value).toBe(5);
    expect(gate.parameters.get("threshold")!.value).toBe(-40);
    expect(gate.parameters.get("enabled")!.value).toBe(1);
  });

  it("applies changes to its tuning while running", async () => {
    await init();
    settings$.next({ ...defaultMicProcessing, bass: 6 });
    tuning$.next({
      rumbleCutoffHz: 120,
      noiseReduction: { floorDb: -20, delaySeconds: 0.02 },
      equaliser: { bassHz: 150, midHz: 2500, midQ: 2, trebleHz: 6000 },
      headroom: false,
      limiter: {
        thresholdDb: -1,
        kneeDb: 2,
        ratio: 10,
        attackSeconds: 0.001,
        releaseSeconds: 0.2,
      },
      gate: {
        holdSeconds: 0.5,
        attackSeconds: 0.01,
        releaseSeconds: 0.3,
        hysteresisDb: 3,
        floorDb: -40,
      },
    });

    const [highpass, headroom, bass, mid, treble, limiter, gate] = chain(
      fake,
    ) as [
      BiquadFilterNode,
      GainNode,
      BiquadFilterNode,
      BiquadFilterNode,
      BiquadFilterNode,
      DynamicsCompressorNode,
      FakeGate,
    ];
    expect(highpass.frequency.value).toBe(120);
    expect(headroom.gain.value).toBe(1);
    expect(bass.frequency.value).toBe(150);
    expect(mid.frequency.value).toBe(2500);
    expect(mid.Q.value).toBe(2);
    expect(treble.frequency.value).toBe(6000);
    expect(limiter).toMatchObject({
      threshold: { value: -1 },
      knee: { value: 2 },
      ratio: { value: 10 },
      attack: { value: 0.001 },
      release: { value: 0.2 },
    });
    expect(gate.parameters.get("hold")!.value).toBe(0.5);
    expect(gate.parameters.get("attack")!.value).toBe(0.01);
    expect(gate.parameters.get("release")!.value).toBe(0.3);
    expect(gate.parameters.get("hysteresis")!.value).toBe(3);
    expect(gate.parameters.get("floor")!.value).toBe(-40);
  });

  it("reports how hard the limiter is working", async () => {
    expect(processor.limiterReduction).toBe(0);
    await init();
    expect(processor.limiterReduction).toBe(-4);
  });

  it("adds noise reduction after the rumble filter while it is on", async () => {
    await init();
    settings$.next({ ...defaultMicProcessing, noiseReduction: true });
    await flushPromises();

    expect(createNoiseReduction).toHaveBeenCalledWith(fake.context);
    expect(chain(fake)[1]).toBe(noiseReduction);

    settings$.next(defaultMicProcessing);
    expect(noiseReduction.destroy).toHaveBeenCalled();
    expect(chain(fake)).not.toContain(noiseReduction);
    expect(chain(fake)).toHaveLength(7);
  });

  it("mixes the unprocessed sound back in under noise reduction, in time with it", async () => {
    await init();
    settings$.next({ ...defaultMicProcessing, noiseReduction: true });
    await flushPromises();
    const [highpass, , mix] = chain(fake) as FakeNode[];
    const [, delay] = highpass.connections as (FakeNode & {
      delayTime: { value: number };
    })[];
    const dryGain = delay.connections[0] as FakeNode & {
      gain: { value: number };
    };

    expect(noiseReduction.connections).toEqual([mix]);
    expect(delay.delayTime.value).toBe(
      defaultMicTuning.noiseReduction.delaySeconds,
    );
    expect(dryGain.connections).toEqual([mix]);
    expect(dryGain.gain.value).toBeCloseTo(
      10 ** (defaultMicTuning.noiseReduction.floorDb / 20),
    );

    tuning$.next({
      ...defaultMicTuning,
      noiseReduction: { floorDb: -20, delaySeconds: 0.025 },
    });
    expect(dryGain.gain.value).toBeCloseTo(0.1);
    expect(delay.delayTime.value).toBe(0.025);

    tuning$.next({
      ...defaultMicTuning,
      noiseReduction: { floorDb: -100, delaySeconds: 0.025 },
    });
    // None of it at the lowest floor, as RNNoise does on its own
    expect(dryGain.gain.value).toBe(0);
  });

  it("reports when noise reduction cannot start", async () => {
    createNoiseReduction.mockRejectedValue(new Error("no wasm"));
    await init();
    settings$.next({ ...defaultMicProcessing, noiseReduction: true });
    await flushPromises();

    expect(processor.unavailable$.value).toEqual({
      noiseReduction: true,
      gate: false,
    });
    expect(chain(fake)).toHaveLength(7);
  });

  it("works without the gate where audio worklets are unavailable", async () => {
    fake.addModule.mockRejectedValue(new Error("no worklets"));
    await init();

    expect(processor.unavailable$.value.gate).toBe(true);
    const nodes = chain(fake);
    expect(nodes).toHaveLength(6);
    expect(nodes[5]).toMatchObject({ kind: "compressor" });
    expect(processor.level$.value).toBeNull();
  });

  it("publishes the gate's level reports", async () => {
    await init();
    const gate = chain(fake)[6] as FakeGate;
    gate.port.onmessage!({ data: { level: -30, open: true } });

    expect(processor.level$.value).toEqual({ level: -30, open: true });
  });

  it("plays the processed voice back only while monitoring", async () => {
    processor.setMonitoring(true);
    await init();
    const monitor = (chain(fake)[6] as FakeNode).connections[1] as GainNode &
      FakeNode;

    expect(monitor.connections).toEqual([fake.destination]);
    expect(monitor.gain.value).toBe(1);
    processor.setMonitoring(false);
    expect(monitor.gain.value).toBe(0);
    expect(processor.monitoring$.value).toBe(false);
  });

  it("follows the microphone when its track is replaced", async () => {
    await init();
    const [highpass] = chain(fake);
    const newTrack = { id: "new mic" } as unknown as MediaStreamTrack;
    await processor.restart({
      kind: Track.Kind.Audio,
      track: newTrack,
      audioContext: {} as AudioContext,
    });

    expect(fake.sources[0].disconnect).toHaveBeenCalled();
    expect(fake.sources[1].stream.tracks).toEqual([newTrack]);
    expect(chain(fake)[0]).toBe(highpass);
  });

  it("is the active processor until it is destroyed", async () => {
    await init();
    expect(activeMicProcessor$.value).toBe(processor);

    await processor.destroy();
    expect(activeMicProcessor$.value).toBeNull();
    expect(fake.close).toHaveBeenCalled();
    expect(fake.outputTrack.stop).toHaveBeenCalled();
    expect(processor.processedTrack).toBeUndefined();
  });
});

function fakeLocalAudioTrack({
  processor,
  readyState = "live",
  noiseSuppression,
}: {
  processor?: unknown;
  readyState?: string;
  noiseSuppression?: boolean[];
} = {}): LocalAudioTrack {
  const settings = noiseSuppression ?? [];
  return {
    getProcessor: vi.fn(() => processor),
    setProcessor: vi.fn().mockResolvedValue(undefined),
    stopProcessor: vi.fn().mockResolvedValue(undefined),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    restartTrack: vi.fn().mockResolvedValue(undefined),
    mediaStreamTrack: {
      readyState,
      getSettings: () => ({ noiseSuppression: settings.shift() }),
    },
  } as unknown as LocalAudioTrack;
}

describe("applyMicProcessor", () => {
  const processor = new MicProcessor(new BehaviorSubject(defaultMicProcessing));

  test("attaches the processor to a track without it", () => {
    const track = fakeLocalAudioTrack();
    applyMicProcessor(track, processor);
    expect(track.setProcessor).toHaveBeenCalledWith(processor);
  });

  test("leaves an attached processor alone", () => {
    const track = fakeLocalAudioTrack({ processor });
    applyMicProcessor(track, processor);
    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(track.stopProcessor).not.toHaveBeenCalled();
  });

  test("detaches the processor when it is no longer wanted", () => {
    const track = fakeLocalAudioTrack({ processor });
    applyMicProcessor(track, undefined);
    expect(track.stopProcessor).toHaveBeenCalled();
  });

  test("does not attach to an ended track", () => {
    const track = fakeLocalAudioTrack({ readyState: "ended" });
    applyMicProcessor(track, processor);
    expect(track.setProcessor).not.toHaveBeenCalled();
  });
});

describe("syncBrowserNoiseSuppression", () => {
  test("does nothing when the track already matches", async () => {
    const track = fakeLocalAudioTrack({ noiseSuppression: [false] });
    await syncBrowserNoiseSuppression(track, false);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("does nothing when the browser does not say", async () => {
    const track = fakeLocalAudioTrack();
    await syncBrowserNoiseSuppression(track, false);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("changes the setting in place where the browser allows it", async () => {
    const track = fakeLocalAudioTrack({ noiseSuppression: [true, false] });
    await syncBrowserNoiseSuppression(track, false);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      noiseSuppression: false,
    });
    expect(track.restartTrack).not.toHaveBeenCalled();
  });

  test("restarts the track where the browser ignores the change", async () => {
    const track = fakeLocalAudioTrack({ noiseSuppression: [true, true] });
    await syncBrowserNoiseSuppression(track, false);
    expect(track.restartTrack).toHaveBeenCalled();
  });
});
