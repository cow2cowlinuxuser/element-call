/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TooltipProvider } from "@vector-im/compound-web";

import { VoiceProcessingButton } from "./VoiceProcessingButton";
import { micProcessing } from "../settings/settings";

afterEach(() => micProcessing.setValue({}));

function renderButton(): void {
  render(
    <TooltipProvider>
      <VoiceProcessingButton />
    </TooltipProvider>,
  );
}

test("opens the voice processing controls", async () => {
  const user = userEvent.setup();
  renderButton();

  await user.click(screen.getByRole("button", { name: "Voice processing" }));

  const dialog = screen.getByRole("dialog", { name: "Voice processing" });
  expect(dialog).toContainElement(
    screen.getByRole("checkbox", { name: "Noise reduction" }),
  );
  expect(
    screen.queryByRole("heading", { level: 4, name: "Voice processing" }),
  ).toBeNull();
});

test("offers advanced tuning in the same window", async () => {
  const user = userEvent.setup();
  renderButton();
  await user.click(screen.getByRole("button", { name: "Voice processing" }));

  await user.click(screen.getByText("Advanced tuning"));
  expect(
    screen.getByRole("heading", { name: "Noise gate timing" }),
  ).toBeVisible();
});

test("stands out while any voice processing is on", () => {
  micProcessing.setValue({ treble: 3 });
  renderButton();
  expect(
    screen.getByRole("button", { name: "Voice processing" }),
  ).toHaveAttribute("data-kind", "primary");
});

test("is plain while voice processing is off", () => {
  renderButton();
  expect(
    screen.getByRole("button", { name: "Voice processing" }),
  ).toHaveAttribute("data-kind", "secondary");
});

test("is plain once voice processing is turned off, whatever is set", () => {
  micProcessing.setValue({ enabled: false, treble: 3, noiseReduction: true });
  renderButton();
  expect(
    screen.getByRole("button", { name: "Voice processing" }),
  ).toHaveAttribute("data-kind", "secondary");
});
