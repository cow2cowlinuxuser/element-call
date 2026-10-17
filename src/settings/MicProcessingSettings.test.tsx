/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TooltipProvider } from "@vector-im/compound-web";
import { BehaviorSubject } from "rxjs";
import { axe } from "vitest-axe";

import { MicProcessingSettings } from "./MicProcessingSettings";
import { micProcessing } from "./settings";
import { getMicProcessing } from "../state/MicProcessing";
import {
  type MicLevel,
  micLevelWanted$,
  type MicProcessor,
  type MicProcessorUnavailable,
} from "../livekit/MicProcessor";

const { activeMicProcessor } = vi.hoisted(() => ({
  activeMicProcessor: { current: null as unknown },
}));
vi.mock("../livekit/MicProcessor", async (importOriginal) => {
  const { BehaviorSubject } = await import("rxjs");
  const subject = new BehaviorSubject<unknown>(null);
  activeMicProcessor.current = subject;
  return {
    ...(await importOriginal<object>()),
    activeMicProcessor$: subject,
  };
});

function setActiveProcessor(processor: MicProcessor | null): void {
  (activeMicProcessor.current as BehaviorSubject<unknown>).next(processor);
}

function fakeProcessor(
  unavailable: Partial<MicProcessorUnavailable> = {},
): MicProcessor {
  const monitoring$ = new BehaviorSubject(false);
  return {
    level$: new BehaviorSubject<MicLevel | null>({ level: -30, open: true }),
    monitoring$,
    unavailable$: new BehaviorSubject({
      noiseReduction: false,
      gate: false,
      ...unavailable,
    }),
    setMonitoring: vi.fn((on: boolean) => monitoring$.next(on)),
  } as unknown as MicProcessor;
}

function renderSettings(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <MicProcessingSettings />
    </TooltipProvider>,
  );
}

afterEach(() => {
  micProcessing.setValue({});
  setActiveProcessor(null);
});

test("turns noise reduction and the gate on and off", async () => {
  const user = userEvent.setup();
  renderSettings();

  await user.click(screen.getByRole("checkbox", { name: "Noise reduction" }));
  expect(getMicProcessing().noiseReduction).toBe(true);

  await user.click(screen.getByRole("checkbox", { name: "Noise gate" }));
  expect(getMicProcessing().gate).toBe(true);

  await user.click(screen.getByRole("checkbox", { name: "Noise reduction" }));
  expect(getMicProcessing().noiseReduction).toBe(false);
});

test("turning processing off greys out the rest and hides the meter", async () => {
  const user = userEvent.setup();
  micProcessing.setValue({ gate: true, bass: -5 });
  setActiveProcessor(fakeProcessor());
  renderSettings();
  expect(screen.getByRole("meter")).toBeInTheDocument();

  await user.click(
    screen.getByRole("checkbox", { name: "Process my microphone" }),
  );
  expect(getMicProcessing()).toMatchObject({
    enabled: false,
    gate: true,
    bass: -5,
  });
  expect(
    screen.getByRole("checkbox", { name: "Noise reduction" }),
  ).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Noise gate" })).toBeDisabled();
  expect(screen.getByRole("slider", { name: "Bass -5 dB" })).toHaveAttribute(
    "data-disabled",
  );
  expect(screen.queryByRole("meter")).toBeNull();
  screen.getByText(
    "Voice processing is off. Others hear your microphone without any of these changes.",
  );

  await user.click(
    screen.getByRole("checkbox", { name: "Process my microphone" }),
  );
  expect(getMicProcessing().enabled).toBe(true);
  expect(screen.getByRole("meter")).toBeInTheDocument();
});

test("the threshold can be changed only while the gate is on", async () => {
  const user = userEvent.setup();
  renderSettings();
  const threshold = (): HTMLElement =>
    screen.getByRole("slider", { name: /^-50 dB$/ });

  expect(threshold()).toHaveAttribute("data-disabled");
  await user.click(screen.getByRole("checkbox", { name: "Noise gate" }));
  expect(threshold()).not.toHaveAttribute("data-disabled");

  threshold().focus();
  await user.keyboard("{ArrowRight}");
  expect(getMicProcessing().gateThreshold).toBe(-49);
});

test("adjusts and resets the voice equaliser", async () => {
  const user = userEvent.setup();
  micProcessing.setValue({ bass: 4, gate: true });
  renderSettings();

  screen.getByRole("slider", { name: "Treble 0 dB" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(getMicProcessing().treble).toBe(-1);

  await user.click(
    screen.getByRole("button", { name: "Reset voice processing" }),
  );
  expect(micProcessing.getValue()).toEqual({});
});

test("asks for the microphone level only while shown", () => {
  const { unmount } = renderSettings();
  expect(micLevelWanted$.value).toBe(true);
  unmount();
  expect(micLevelWanted$.value).toBe(false);
});

test("explains that the level shows during a call", () => {
  renderSettings();
  screen.getByText("Your microphone level shows here during a call.");
  expect(screen.queryByRole("meter")).toBeNull();
});

test("shows the microphone level and gate threshold during a call", async () => {
  micProcessing.setValue({ gate: true });
  setActiveProcessor(fakeProcessor());
  const { container } = renderSettings();

  const meter = screen.getByRole("meter", { name: "Microphone level" });
  expect(meter).toHaveAttribute("aria-valuenow", "-30");
  expect(meter).toHaveAttribute("aria-valuetext", "-30 dB");
  expect(await axe(container)).toHaveNoViolations();
});

test("hearing yourself lasts only while the settings are open", async () => {
  const user = userEvent.setup();
  const processor = fakeProcessor();
  setActiveProcessor(processor);
  const { unmount } = renderSettings();

  await user.click(screen.getByRole("checkbox", { name: "Hear myself" }));
  expect(processor.setMonitoring).toHaveBeenLastCalledWith(true);
  unmount();
  expect(processor.setMonitoring).toHaveBeenLastCalledWith(false);
});

test("says when a stage could not start", () => {
  micProcessing.setValue({ noiseReduction: true });
  setActiveProcessor(fakeProcessor({ noiseReduction: true, gate: true }));
  renderSettings();

  screen.getByText("Noise reduction could not start on this device.");
  screen.getByText(
    "The noise gate and level meter could not start on this device.",
  );
  expect(screen.queryByRole("meter")).toBeNull();
});
