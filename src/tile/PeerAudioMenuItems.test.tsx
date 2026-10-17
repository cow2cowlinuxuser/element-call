/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { TooltipProvider } from "@vector-im/compound-web";

import { PeerAudioMenuItems } from "./PeerAudioMenuItems";
import { constant } from "../state/Behavior";
import { defaultPeerAudio, type PeerAudio } from "../state/PeerAudio";
import { type PeerAudioControls } from "../state/media/RemoteUserMediaViewModel";

test("shows the member's pan and equaliser settings", async () => {
  const { container } = renderMenuItems({ pan: -0.5, bass: 6, treble: -3 });

  expect(screen.getByRole("slider", { name: "Left 50%" })).toHaveAttribute(
    "aria-valuenow",
    "-0.5",
  );
  expect(screen.getByRole("slider", { name: "Bass +6 dB" })).toHaveAttribute(
    "aria-valuenow",
    "6",
  );
  expect(screen.getByRole("slider", { name: "Mid 0 dB" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect(screen.getByRole("slider", { name: "Treble -3 dB" })).toHaveAttribute(
    "aria-valuenow",
    "-3",
  );
  expect(await axe(container)).toHaveNoViolations();
});

test("adjusts a band from the keyboard", async () => {
  const user = userEvent.setup();
  const { vm } = renderMenuItems({ mid: 2 });

  screen.getByRole("slider", { name: "Mid +2 dB" }).focus();
  await user.keyboard("{ArrowRight}");

  expect(vm.adjustPeerAudio).toHaveBeenLastCalledWith({ mid: 3 });
});

test("resets the member's audio", async () => {
  const user = userEvent.setup();
  const { vm } = renderMenuItems({ pan: 1 });

  await user.click(screen.getByRole("menuitem", { name: "Reset audio" }));

  expect(vm.resetPeerAudio).toHaveBeenCalledOnce();
});

function renderMenuItems(audio: Partial<PeerAudio>): {
  vm: PeerAudioControls;
  container: HTMLElement;
} {
  const vm: PeerAudioControls = {
    peerAudio$: constant({ ...defaultPeerAudio, ...audio }),
    adjustPeerAudio: vi.fn(),
    resetPeerAudio: vi.fn(),
  };
  const { container } = render(
    <TooltipProvider>
      <div role="menu">
        <PeerAudioMenuItems vm={vm} />
      </div>
    </TooltipProvider>,
  );
  return { vm, container };
}
