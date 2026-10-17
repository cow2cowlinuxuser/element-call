/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { miniGridShape } from "./miniGrid";

describe("miniGridShape", () => {
  it("uses the whole space for a single tile", () => {
    expect(miniGridShape(1, 320, 180)).toEqual({
      columns: 1,
      rows: 1,
      tileWidth: 320,
      tileHeight: 180,
    });
  });

  it("puts two tiles side by side in a wide space", () => {
    expect(miniGridShape(2, 400, 200)).toMatchObject({ columns: 2, rows: 1 });
  });

  it("stacks two tiles in a tall space", () => {
    expect(miniGridShape(2, 200, 400)).toMatchObject({ columns: 1, rows: 2 });
  });

  it("makes a 2x2 grid for four tiles in a square-ish space", () => {
    expect(miniGridShape(4, 400, 240)).toMatchObject({ columns: 2, rows: 2 });
  });

  it("accounts for gaps between tiles", () => {
    expect(miniGridShape(2, 408, 200, 8)).toMatchObject({
      columns: 2,
      tileWidth: 200,
      tileHeight: 200,
    });
  });

  it("never reports negative sizes", () => {
    const shape = miniGridShape(6, 10, 10, 8);
    expect(shape.tileWidth).toBeGreaterThanOrEqual(0);
    expect(shape.tileHeight).toBeGreaterThanOrEqual(0);
  });

  it("copes with no tiles", () => {
    expect(miniGridShape(0, 300, 200)).toMatchObject({ columns: 1, rows: 1 });
  });
});
