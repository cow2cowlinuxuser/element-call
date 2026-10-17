/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

export interface MiniGridShape {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

const aspectRatio = 16 / 9;

/**
 * Picks the number of columns that gives the largest tiles when fitting the
 * given number of tiles into a space, assuming tiles look best at 16:9.
 */
export function miniGridShape(
  count: number,
  width: number,
  height: number,
  gap = 0,
): MiniGridShape {
  let best: MiniGridShape = {
    columns: 1,
    rows: Math.max(count, 1),
    tileWidth: width,
    tileHeight: height,
  };
  let bestSize = -1;
  for (let columns = 1; columns <= Math.max(count, 1); columns++) {
    const rows = Math.ceil(Math.max(count, 1) / columns);
    const tileWidth = Math.max(0, (width - gap * (columns - 1)) / columns);
    const tileHeight = Math.max(0, (height - gap * (rows - 1)) / rows);
    // The width of the largest 16:9 box that fits in the cell
    const size = Math.min(tileWidth, tileHeight * aspectRatio);
    if (size > bestSize) {
      bestSize = size;
      best = { columns, rows, tileWidth, tileHeight };
    }
  }
  return best;
}
