/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { pipLayout } from "./PipLayout";
import { TileStore } from "./TileStore";
import { constant } from "./Behavior";
import { type UserMediaViewModel } from "./media/UserMediaViewModel";
import { type ScreenShareViewModel } from "./media/ScreenShareViewModel";

vi.mock("../Platform", () => ({ platform: "desktop" }));

function userMedia(id: string, local = false): UserMediaViewModel {
  return {
    id,
    type: "user",
    local,
    displayName$: constant(id),
  } as unknown as UserMediaViewModel;
}

function screenShare(id: string): ScreenShareViewModel {
  return {
    id,
    type: "screen share",
    local: false,
    displayName$: constant(id),
  } as unknown as ScreenShareViewModel;
}

const local = userMedia("local", true);
const alice = userMedia("alice");

describe("pipLayout", () => {
  it("shows only the spotlight when there are no miniature tiles", () => {
    const [layout] = pipLayout(
      { type: "pip", edgeToEdge: true, spotlight: [alice], grid: [] },
      TileStore.empty(),
    );
    expect(layout.spotlight?.media$.value).toEqual([alice]);
    expect(layout.grid).toEqual([]);
  });

  it("shows everyone as miniature tiles without a redundant spotlight", () => {
    const [layout] = pipLayout(
      {
        type: "pip",
        edgeToEdge: false,
        spotlight: [alice],
        grid: [local, alice],
      },
      TileStore.empty(),
    );
    expect(layout.spotlight).toBeUndefined();
    expect(layout.grid.map((tile) => tile.media$.value)).toEqual([
      local,
      alice,
    ]);
  });

  it("keeps the spotlight for screen shares alongside the miniature tiles", () => {
    const share = screenShare("alice:share");
    const [layout] = pipLayout(
      {
        type: "pip",
        edgeToEdge: false,
        spotlight: [share],
        grid: [local, alice],
      },
      TileStore.empty(),
    );
    expect(layout.spotlight?.media$.value).toEqual([share]);
    expect(layout.grid.map((tile) => tile.media$.value)).toEqual([
      local,
      alice,
    ]);
  });

  it("reuses tiles across updates", () => {
    const [first, tiles] = pipLayout(
      {
        type: "pip",
        edgeToEdge: false,
        spotlight: [alice],
        grid: [local, alice],
      },
      TileStore.empty(),
    );
    const [second] = pipLayout(
      {
        type: "pip",
        edgeToEdge: false,
        spotlight: [alice],
        grid: [local, alice],
      },
      tiles,
    );
    expect(second.grid).toEqual(first.grid);
  });
});
