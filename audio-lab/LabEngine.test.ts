/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { of } from "rxjs";

import { LabEngine } from "./LabEngine";
import { defaultMicTuning } from "../src/livekit/MicProcessor";
import { defaultMicProcessing } from "../src/state/MicProcessing";
import { defaultPeerAudio } from "../src/state/PeerAudio";
import { fakeAudioParam } from "../src/utils/test";

const processedTrack = { id: "processed" };
const processor = {
  init: vi.fn(),
  restart: vi.fn(),
  destroy: vi.fn(),
  processedTrack,
};

vi.mock("../src/livekit/MicProcessor", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MicProcessor: vi.fn(
    class {
      public constructor() {
        return processor;
      }
    },
  ),
}));

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

class FakeMediaStream {
  public constructor(public readonly tracks: unknown[]) {}
}

class FakeAudioContext {
  public destination = new FakeNode();
  public currentTime = 0;
  public sampleRate = 48000;
  public sources: (FakeNode & { stream: FakeMediaStream })[] = [];
  public resume = vi.fn().mockResolvedValue(undefined);
  public close = vi.fn().mockResolvedValue(undefined);
  public createAnalyser = (): FakeNode => new FakeNode();
  public createGain = (): FakeNode =>
    Object.assign(new FakeNode(), { gain: fakeAudioParam(1) });
  public createStereoPanner = (): FakeNode =>
    Object.assign(new FakeNode(), { pan: fakeAudioParam(0) });
  public createBiquadFilter = (): FakeNode =>
    Object.assign(new FakeNode(), {
      frequency: { value: 350 },
      Q: { value: 1 },
      gain: fakeAudioParam(0),
    });
  public createMediaStreamSource = (stream: FakeMediaStream): FakeNode => {
    const source = Object.assign(new FakeNode(), { stream });
    this.sources.push(source);
    return source;
  };
}

describe("LabEngine", () => {
  let engine: LabEngine;
  let context: FakeAudioContext;
  const micTrack = { id: "mic", stop: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getAudioTracks: () => [micTrack] }),
      },
    });
    engine = new LabEngine(of(defaultMicProcessing), of(defaultMicTuning));
    context = engine.context as unknown as FakeAudioContext;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const useMic = async (): Promise<void> =>
    engine.useMic({
      deviceId: "",
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });

  it("runs the microphone through the processor and measures both sides", async () => {
    await useMic();

    expect(processor.init).toHaveBeenCalledWith(
      expect.objectContaining({ track: micTrack }),
    );
    const [raw, processed] = context.sources;
    expect(raw.stream.tracks).toEqual([micTrack]);
    expect(raw.connections).toEqual([engine.rawAnalyser]);
    expect(processed.stream.tracks).toEqual([processedTrack]);
    expect(processed.connections).toEqual([engine.processedAnalyser]);
  });

  it("swaps the source without starting the processor again", async () => {
    await useMic();
    await useMic();

    expect(processor.init).toHaveBeenCalledTimes(1);
    expect(processor.restart).toHaveBeenCalledWith(
      expect.objectContaining({ track: micTrack }),
    );
    expect(micTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("plays whichever side is chosen through the listener's chain", () => {
    const rawAnalyser = engine.rawAnalyser as unknown as FakeNode;
    const processedAnalyser = engine.processedAnalyser as unknown as FakeNode;

    engine.setListenTo("raw");
    expect(rawAnalyser.connections).toHaveLength(1);
    expect(processedAnalyser.connections).toHaveLength(0);

    engine.setListenTo("processed");
    expect(rawAnalyser.connections).toHaveLength(0);
    expect(processedAnalyser.connections).toHaveLength(1);

    engine.setListenTo("off");
    expect(rawAnalyser.connections).toHaveLength(0);
    expect(processedAnalyser.connections).toHaveLength(0);
    expect(engine.getListenTo()).toBe("off");
  });

  it("applies the listener's settings with the tuned bands", () => {
    engine.setListenTo("raw");
    const bass = (engine.rawAnalyser as unknown as FakeNode)
      .connections[0] as BiquadFilterNode;
    engine.setListener(
      { ...defaultPeerAudio, bass: 5 },
      {
        ...defaultMicTuning,
        equaliser: { ...defaultMicTuning.equaliser, bassHz: 180 },
      },
    );

    expect(bass.frequency.value).toBe(180);
    expect(bass.gain.value).toBe(5);
  });

  it("stops the source and closes everything when destroyed", async () => {
    await useMic();
    await engine.destroy();

    expect(micTrack.stop).toHaveBeenCalled();
    expect(processor.destroy).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });
});
