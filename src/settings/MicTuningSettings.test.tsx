/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TooltipProvider } from "@vector-im/compound-web";
import { type BehaviorSubject } from "rxjs";
import { axe } from "vitest-axe";

import { MicTuningSettings } from "./MicTuningSettings";
import { micProcessing, micTuning } from "./settings";
import { defaultMicTuning, type MicProcessor } from "../livekit/MicProcessor";
import { getMicTuning, updateMicTuning } from "../state/MicTuning";
import { getMicProcessing } from "../state/MicProcessing";

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

function renderSettings(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <MicTuningSettings />
    </TooltipProvider>,
  );
}

afterEach(() => {
  micProcessing.setValue({});
  micTuning.setValue({});
  (activeMicProcessor.current as BehaviorSubject<unknown>).next(null);
  vi.useRealTimers();
});

test("shows a control for every part of the tuning", async () => {
  const { container } = renderSettings();
  expect(
    screen.getByRole("heading", { name: "Noise reduction strength" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Limiter" })).toBeInTheDocument();
  expect(screen.getAllByRole("slider")).toHaveLength(17);
  expect(screen.getAllByText("2.39 kHz").length).toBeGreaterThan(0);
  expect(await axe(container)).toHaveNoViolations();
});

test("turns equaliser headroom on and off", async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.click(
    screen.getByRole("checkbox", { name: /Make room for equaliser boosts/ }),
  );
  expect(getMicTuning().headroom).toBe(true);
});

test("resets the tuning to the defaults", async () => {
  const user = userEvent.setup();
  updateMicTuning({ ...defaultMicTuning, rumbleCutoffHz: 40 });
  renderSettings();
  expect(screen.getAllByText("40 Hz").length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: "Reset tuning" }));
  expect(micTuning.getValue()).toEqual({});
});

test("applies settings pasted from the audio lab", async () => {
  const user = userEvent.setup();
  renderSettings();
  const pasted = JSON.stringify({
    settings: { gate: true, gateThreshold: -20 },
    tuning: { gate: { holdSeconds: 0.5 } },
  });
  await user.click(screen.getByRole("textbox"));
  await user.paste(pasted);
  await user.click(
    screen.getByRole("button", { name: "Apply pasted settings" }),
  );

  expect(getMicProcessing()).toMatchObject({ gate: true, gateThreshold: -20 });
  expect(getMicTuning().gate.holdSeconds).toBe(0.5);
  expect(screen.getByRole("status")).toHaveTextContent("Settings applied");
});

test("says so when pasted settings cannot be read", async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("textbox"));
  await user.paste("{not json");
  await user.click(
    screen.getByRole("button", { name: "Apply pasted settings" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Those settings could not be read",
  );
});

test("copies the current settings", async () => {
  const user = userEvent.setup();
  updateMicTuning({ ...defaultMicTuning, headroom: true });
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Copy settings" }));

  const copied = JSON.parse(
    (screen.getByRole("textbox") as HTMLTextAreaElement).value,
  );
  expect(copied.tuning.headroom).toBe(true);
  expect(copied.settings.gate).toBe(false);
  expect(await navigator.clipboard.readText()).toBe(
    (screen.getByRole("textbox") as HTMLTextAreaElement).value,
  );
});

test("shows how hard the limiter is working during a call", async () => {
  vi.useFakeTimers();
  const processor = { limiterReduction: -3.14 } as unknown as MicProcessor;
  (activeMicProcessor.current as BehaviorSubject<unknown>).next(processor);
  renderSettings();
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(
    screen.getByText("Limiter is turning you down by -3.1 dB"),
  ).toBeInTheDocument();
});
