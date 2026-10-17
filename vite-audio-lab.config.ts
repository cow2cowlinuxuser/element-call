/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { defineConfig, searchForWorkspaceRoot } from "vite";

import { vitePluginsConfig } from "./vite.config.ts";

// Serves the audio lab under `audio-lab`, a test bench for the microphone
// processing that runs Element Call's own audio code outside of a call.
// Development only: this is not something we build or ship.
export default defineConfig(({ mode }) => ({
  ...vitePluginsConfig({ mode, html: false }),
  root: "audio-lab",
  server: {
    // localhost counts as a secure context, which the microphone needs
    host: "localhost",
    // Clear of the standalone app's and the component harness's
    port: 3002,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  worker: {
    format: "es",
  },
  resolve: {
    dedupe: ["react", "react-dom", "matrix-js-sdk"],
  },
}));
