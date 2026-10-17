/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";

import { AudioLab } from "./AudioLab";
import EN from "../locales/en/app.json";
import { i18n } from "../src/utils/i18n";
import "./lab.css";

// Element Call's own English strings, so that shared controls read the same
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: EN } },
  interpolation: { escapeValue: false },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AudioLab />
  </StrictMode>,
);
