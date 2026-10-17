# Expedition browser play verification

Run the repository HTTP server on port 8081, then:

```sh
node tools/verify-expedition-browser.mjs
```

The script creates a fresh seed-63026 world. It reads `window.FERAL` only for state and target coordinates. Walking, looking, gathering, research, crafting, and placement use real Playwright keyboard/pointer/DOM inputs. It does not grant inventory, discover research, teleport the player, call runtime gameplay actions, or accelerate the clock.

Screenshots and `expedition-browser-report.json` record the observed milestones. The script saves through the visible menu and exports that genuine browser storage on exit. If a run is interrupted by an automation limit, resume its ordinary save with:

```sh
FERAL_RESUME=1 node tools/verify-expedition-browser.mjs
```

`browser-storage.json` is a fresh test-world save, not an inventory fixture. It must not be edited to bypass progression. The script runs headless Chromium with Linux SwiftShader software WebGL. Its observed timing is not a measurement of a physical Android device or hardware-accelerated desktop GPU.

The 2026-10-17 continuation resumed the prior save without resetting it. The preserved input backup under `attempt-3/browser-storage-input.json` has SHA256 `6201124623274f6d98c192a9af377a8d30d1956a1b2b7c5ae80acd13e348fcea`. Normal keyboard/pointer/menu inputs gathered raw timber and loose stone, crafted a stone pickaxe, processed wood, and saved through the visible menu. After page reload, the inventory, three research entries, field bench and placement matched. The report contains nine checkpoints; it has no page errors or failed requests. The sole browser-console message is the missing site's `/favicon.ico` (404), unrelated to game-module loading.

After completion, the genuine browser save at `browser-storage.json` has SHA256 `b87155a433a00ec97739667e1f1890cfa49d691fa75cd52b9c61e6a5b9e4f15f`. The exact inputs and state comparison are in [`expedition-browser-report.json`](expedition-browser-report.json).

Earlier attempts are retained separately. Attempt 1 reached placed-workbench completion, then attempted wood research outside workbench range; the disabled button was correct. Attempt 2 returned to the workbench and completed wood research, then navigation to a farther timber node was blocked. The helper now allows 400 iterations, skips blocked nodes for that harvest pass, and preserves UI saves after each checkpoint. Attempt 3 loaded the saved browser state but the app never became ready because `content-runtime/armaments.js` returned 404 during an incomplete integration; it did not reach gameplay or mutate the save. Its exact input and failure report are preserved under `attempt-3/`. These automation or incomplete-build failures must not be reported as game softlocks.
