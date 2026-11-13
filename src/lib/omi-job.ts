import { addJob } from "./scheduler";
import { getSettings } from "./settings";
import { readJson } from "./store";
import { OMI_STATE, importFromOmi, type OmiState } from "./omi";

const EVERY_MS = 6 * 60 * 60_000;

// Auto-import OMI conversations a few times a day when it's switched on in Settings → OMI.
addJob("omi-import", async () => {
  const s = await getSettings();
  if (!s.omi.autoImport || !s.omi.apiKey) return;
  const st = await readJson<OmiState>(OMI_STATE, {});
  if (st.lastImportAt && Date.now() - st.lastImportAt < EVERY_MS) return;
  await importFromOmi(s);
});
