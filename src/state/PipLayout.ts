/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { platform } from "../Platform.ts";
import { type PipLayout, type PipLayoutMedia } from "./layout-types.ts";
import { type TileStore } from "./TileStore";

/**
 * Produces a picture-in-picture layout with the given media.
 */
export function pipLayout(
  media: PipLayoutMedia,
  prevTiles: TileStore,
): [PipLayout, TileStore] {
  const update = prevTiles.from(media.grid.length);
  // The miniature tiles already show everyone's user media, so the spotlight
  // is only worth the space when it has something else to show
  if (
    media.grid.length === 0 ||
    media.spotlight.some((vm) => vm.type !== "user")
  )
    // Dont maximise in pip on EW since we want the rounded corners and the footer
    update.registerSpotlight(
      media.spotlight,
      platform === "desktop" ? false : true,
      "transparent",
    );
  for (const mediaVm of media.grid) update.registerGridTile(mediaVm);
  const tiles = update.build();
  return [
    {
      type: media.type,
      spotlight: tiles.spotlightTile,
      grid: tiles.gridTiles,
    },
    tiles,
  ];
}
