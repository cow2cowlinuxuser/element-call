/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { defaultMicTuning, MIC_GATE_PROCESSOR } from "./MicProcessor";

const SAMPLE_RATE = 48000;
const BLOCK = 128;
/** Blocks in one second. */
const SECOND = SAMPLE_RATE / BLOCK;

interface Gate {
  port: { postMessage: ReturnType<typeof vi.fn> };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

let name = "";
let Processor: new () => Gate;

beforeAll(async () => {
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      public port = { postMessage: vi.fn() };
    },
  );
  vi.stubGlobal(
    "registerProcessor",
    (registeredName: string, registered: new () => Gate) => {
      name = registeredName;
      Processor = registered;
    },
  );
  vi.stubGlobal("sampleRate", SAMPLE_RATE);
  await import("./micGate.worklet.js");
});

afterAll(() => vi.unstubAllGlobals());

function loadGate(): { name: string; gate: Gate } {
  return { name, gate: new Processor() };
}

/**
 * Feeds blocks of a constant signal at the given level through the gate,
 * returning the last output sample.
 */
interface GateParameters {
  threshold: number;
  enabled: boolean;
  hold: number;
  attack: number;
  release: number;
  hysteresis: number;
  floor: number;
}

/** The gain of a closed gate. */
const FLOOR = 10 ** (defaultMicTuning.gate.floorDb / 20);

function parameters({
  threshold = -50,
  enabled = true,
  hold = defaultMicTuning.gate.holdSeconds,
  attack = defaultMicTuning.gate.attackSeconds,
  release = defaultMicTuning.gate.releaseSeconds,
  hysteresis = defaultMicTuning.gate.hysteresisDb,
  floor = defaultMicTuning.gate.floorDb,
}: Partial<GateParameters> = {}): Record<string, Float32Array> {
  return {
    threshold: new Float32Array([threshold]),
    enabled: new Float32Array([enabled ? 1 : 0]),
    hold: new Float32Array([hold]),
    attack: new Float32Array([attack]),
    release: new Float32Array([release]),
    hysteresis: new Float32Array([hysteresis]),
    floor: new Float32Array([floor]),
  };
}

function feed(
  gate: Gate,
  levelDb: number,
  blocks: number,
  params: Partial<GateParameters> = {},
): number {
  const amplitude = 10 ** (levelDb / 20);
  let last = 0;
  for (let i = 0; i < blocks; i++) {
    const input = new Float32Array(BLOCK).fill(amplitude);
    const output = new Float32Array(BLOCK);
    gate.process([[input]], [[output]], parameters(params));
    last = output[BLOCK - 1] / amplitude;
  }
  return last;
}

test("registers under the name the processor asks for", () => {
  expect(loadGate().name).toBe(MIC_GATE_PROCESSOR);
});

test("passes everything through while turned off", () => {
  const { gate } = loadGate();
  expect(feed(gate, -70, SECOND, { enabled: false })).toBeCloseTo(1);
});

test("passes a voice above the threshold", () => {
  const { gate } = loadGate();
  expect(feed(gate, -20, SECOND)).toBeCloseTo(1);
});

test("turns noise below the threshold down once the hold time has passed", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10);
  expect(feed(gate, -70, SECOND / 10)).toBeGreaterThan(0.9);
  expect(feed(gate, -70, SECOND * 5)).toBeCloseTo(FLOOR, 3);
});

test("silences noise entirely with the lowest floor", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10);
  expect(feed(gate, -70, SECOND * 5, { floor: -100 })).toBeLessThan(0.0001);
});

test("dips down gradually rather than dropping", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10);
  // Past the hold time, then partway into the release
  const holdBlocks = Math.ceil(defaultMicTuning.gate.holdSeconds * SECOND);
  feed(gate, -70, holdBlocks);
  const partway = feed(gate, -70, SECOND / 20);
  expect(partway).toBeLessThan(0.9);
  expect(partway).toBeGreaterThan(0.4);
});

test("opens again within milliseconds when the voice returns", () => {
  const { gate } = loadGate();
  feed(gate, -70, SECOND);
  expect(feed(gate, -20, SECOND / 20)).toBeGreaterThan(0.9);
});

test("stays open for a voice dipping just under the threshold", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10);
  expect(feed(gate, -53, SECOND * 2)).toBeCloseTo(1);
});

test("reports the level and gate state for a meter", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10);
  expect(gate.port.postMessage).toHaveBeenLastCalledWith({
    level: expect.closeTo(-20, 1),
    open: true,
  });

  feed(gate, -70, SECOND);
  expect(gate.port.postMessage).toHaveBeenLastCalledWith({
    level: expect.closeTo(-70, 1),
    open: false,
  });
});

test("outputs silence when there is no input", () => {
  const { gate } = loadGate();
  const output = new Float32Array(BLOCK).fill(1);
  gate.process([[]], [[output]], parameters());
  expect(output.every((sample) => sample === 0)).toBe(true);
});

test("declares the tuning parameters with the default tuning", () => {
  const descriptors = (
    Processor as unknown as {
      parameterDescriptors: { name: string; defaultValue: number }[];
    }
  ).parameterDescriptors;
  const defaults = Object.fromEntries(
    descriptors.map((d) => [d.name, d.defaultValue]),
  );
  expect(defaults).toEqual({
    threshold: -50,
    enabled: 0,
    hold: defaultMicTuning.gate.holdSeconds,
    attack: defaultMicTuning.gate.attackSeconds,
    release: defaultMicTuning.gate.releaseSeconds,
    hysteresis: defaultMicTuning.gate.hysteresisDb,
    floor: defaultMicTuning.gate.floorDb,
  });
});

test("holds open for as long as it is tuned to", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10, { hold: 1 });
  expect(feed(gate, -70, SECOND / 2, { hold: 1 })).toBeGreaterThan(0.9);
  expect(feed(gate, -70, SECOND * 5, { hold: 1 })).toBeCloseTo(FLOOR, 3);
});

test("closes on a dip larger than the tuned hysteresis", () => {
  const { gate } = loadGate();
  feed(gate, -20, SECOND / 10, { hysteresis: 1 });
  expect(feed(gate, -53, SECOND * 5, { hysteresis: 1 })).toBeCloseTo(FLOOR, 3);
});

test("fades in as slowly as it is tuned to", () => {
  const { gate } = loadGate();
  feed(gate, -70, SECOND);
  expect(feed(gate, -20, SECOND / 50, { attack: 0.5 })).toBeLessThan(0.2);
});
