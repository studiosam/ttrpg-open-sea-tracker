# Open Sea Tracker Roadmap

This roadmap tracks the current direction for the Open Sea Tracker project.

The project began as the Marrowwind voyage tracker for one campaign. The long-term goal is to turn it into a reusable browser-based encounter tracker for dangerous sea travel and other high-bookkeeping tabletop scenarios.

---

# Current Project Status

The project is a working MVP and public demo.

The core tracker can now be used at the table with a DM screen and a player-facing screen. It has automated tests, formatting checks, syntax checks, GitHub Actions CI, manual browser testing documentation, import/export support, save protection, a functional new-voyage setup flow, GitHub Pages deployment, README screenshots, an `Open Player View` control, and a no-save Demo Mode.

The README, roadmap, and manual testing checklist have been updated for Demo Mode. The next step is a focused browser testing pass using `docs/MANUAL_TESTING.md`.

---

# Completed Core Systems

- DM-facing tracker screen.
- Player-facing display screen.
- Browser `localStorage` saving.
- Export and import.
- Import validation and migration.
- Undo support.
- Turn-flow guidance.
- Open Sea Event handling.
- Scripted scene turns.
- Crew action assignment.
- Required checks and saves.
- Water ingress tracking.
- Course Meter and travel tracking.
- Player knowledge and hidden information.
- Player-safe state publishing.
- Player view auto-sync through browser storage.
- Activity log.
- Automated Node test suite.
- Prettier formatting.
- Syntax checks.
- GitHub Actions CI.
- Manual browser testing checklist.
- README screenshots.
- GitHub Pages deployment.
- Root `index.html` redirect/loading page.
- DM tracker `Open Player View` link.
- No-save Demo Mode.
- Demo-to-real-save conversion.

---

# Completed Setup Work

The landing and setup flow has been completed through Stage 3.

## Stage 1: Ship Name Foundation — Complete

Completed items:

- Added `shipName` to tracker state.
- Added default ship name: `The Marrowwind`.
- Added migration support for old saves missing `shipName`.
- Added validation for imported ship names.
- Included `shipName` in exported saves.
- Included `shipName` in published player state.
- Rendered ship name on the DM screen.
- Rendered ship name on the player screen.
- Added player-view fallback for older player snapshots.

## Stage 2: Setup Mode Shell — Complete

Completed items:

- Added landing/setup/tracker app modes.
- Changed `Start a New Voyage` to open setup mode.
- Added temporary setup draft state.
- Added setup screen shell.
- Added voyage preset display.
- Added ship-name setup field.
- Added crew-size setup field.
- Added active crew-name setup fields.
- Added background/proficiency trait checkboxes.
- Added `Back to Landing`.
- Added `Reset Setup Defaults`.
- Preserved existing saves when opening setup.
- Preserved existing saves when editing setup.
- Preserved existing saves when backing out of setup.

## Stage 2.5: Setup File Split — Complete

Completed items:

- Added `js/tracker_render_setup.js` for landing/setup rendering.
- Added `js/tracker_setup.js` for setup-mode behavior.
- Kept main tracker rendering in `js/tracker_render.js`.
- Kept persistence behavior in `js/tracker_persistence.js`.
- Updated browser script order.
- Updated syntax checks.
- Updated test harness loading.

## Stage 3: Setup Validation and Start Voyage — Complete

Completed items:

- Added setup validation for ship name.
- Reused active crew-name validation.
- Blocked invalid setup from starting.
- Blocked invalid setup from saving.
- Blocked invalid setup from publishing player state.
- Required active crew names to be unique after trimming, case-insensitive.
- Allowed inactive crew rows to be ignored when crew size is smaller.
- Enabled `Start Voyage` for valid setup.
- Created full tracker state from setup draft.
- Applied configured ship name.
- Applied configured crew size.
- Applied configured crew names.
- Applied configured background/proficiency traits.
- Saved valid setup-created voyage to `localStorage`.
- Published valid setup-created player state.
- Entered tracker mode after successful setup.
- Logged new voyage creation.
- Added existing-save overwrite confirmation.
- Preserved old save when overwrite confirmation is cancelled.

---

# Completed Demo Work

## Demo Mode: Temporary No-Save Sandbox — Complete

Completed items:

- Added `Load Demo Voyage` to the landing screen.
- Used the existing default Marrowwind starting state.
- Entered tracker mode immediately from Demo Mode.
- Published player-safe state so the player view works.
- Avoided writing demo state to the normal saved-voyage slot automatically.
- Marked demo-created tracker state with demo mode.
- Displayed a visible DM-side Demo Mode banner.
- Preserved the existing real saved voyage when loading demo.
- Kept `Resume Current Voyage` pointed at the real saved voyage.
- Allowed export from Demo Mode.
- Added tests for demo loading and save preservation.

## Demo Save Conversion — Complete

Completed items:

- Updated normal save behavior while in Demo Mode.
- Added confirmation before converting a demo voyage into a real saved voyage.
- Cancelled demo save leaves the real save untouched.
- Confirmed demo save clears demo mode.
- Confirmed demo save writes to the normal saved-voyage slot.
- Confirmed demo save publishes player state.
- Confirmed demo save removes the demo banner.
- Added tests for cancelled and confirmed demo-save conversion.

## Manual Testing Coverage for Demo Mode — Complete

Completed items:

- Added Demo Mode checks to `docs/MANUAL_TESTING.md`.
- Added landing-screen check for `Load Demo Voyage`.
- Added demo banner checks.
- Added player view checks for demo data.
- Added protection checks for existing real saves.
- Added demo save-conversion checks.
- Added export/import checks for demo behavior.
- Removed Demo Mode from future-expansion testing notes.

---

# Immediate Priorities

These are the next practical steps before larger feature systems.

## 1. Focused Manual Browser Testing

Status: Next

Use `docs/MANUAL_TESTING.md` to test the current app in a real browser.

Focus areas:

- Landing screen.
- Load Demo Voyage.
- Demo Mode banner.
- Demo Mode save protection.
- Demo-to-real-save conversion.
- New voyage setup.
- Setup validation.
- Existing-save overwrite protection.
- Resume current voyage.
- Import saved voyage.
- DM tracker load.
- Player view sync.
- `Open Player View` button.
- GitHub Pages hosted behavior.
- Water visibility rules.
- Navigate reveal behavior.
- Scripted scene turn behavior.
- Export/import.
- Invalid import rejection.
- Prompt escaping.
- Layout smoke test.

Reason:

Automated tests are strong, but browser UI behavior, layout, `localStorage` behavior, hosted paths, and second-screen sync still need real-browser verification.

## 2. Fix Manual Test Failures

Status: As Needed

Only fix issues that surface during manual testing.

Do not add new feature work during a bug-fix pass unless the fix clearly requires it.

## 3. Keep Documentation Current

Status: Ongoing

Keep `README.md`, `docs/ROADMAP.md`, `docs/MANUAL_TESTING.md`, `docs/design_document.txt`, and `docs/MarrowWindActions.txt` aligned with the current app.

Current policy:

- Git history is the changelog.
- The roadmap is the source of truth for planned work.
- Temporary staging or scratch notes should be deleted once useful details are moved into the roadmap or implementation.

Recently completed:

- Removed obsolete scratch/staging doc references.
- Removed the stale changelog reference from the README.
- Confirmed no separate changelog is needed.
- Updated manual testing notes for setup field max-length behavior.

---

# Next Feature Phase: Starting Presets and First-Time Use

The setup flow and Demo Mode now exist. The next feature work should turn the setup screen from a single default configuration into a small set of useful starting choices.

## 1. Starting Presets

Status: Next Feature After Manual Testing

Goal:

Allow the DM to choose from predefined starting configurations.

Possible first presets:

- Marrowwind Voyage.
- Open Sea Default.
- Short Demo Voyage.
- Damaged Ship Start.
- Low-Supply Survival Start.

Each preset could define:

- default ship name.
- default crew size.
- default crew names.
- default crew traits.
- starting travel distance.
- starting water level.
- starting supplies.
- starting repair materials.
- starting Course Meter.
- scripted event table.
- Open Sea Event table.

Keep this limited at first. Do not build custom event-table editing during the first preset pass.

Reason:

Presets are the bridge between a campaign-specific Marrowwind tracker and a reusable sea-travel tool.

## 2. Setup Polish

Status: Not Started

Possible improvements:

- clearer setup validation messages.
- better visual grouping of background/proficiency traits.
- short help text explaining which traits affect which actions.
- optional collapse/expand for advanced fields.
- clearer difference between preset selection and custom fields.

Do not add advanced mechanical setup yet unless presets require it.

---

# Next Feature Phase: Event Table Improvements

The current Open Sea Event system works, but it is still tied closely to the current voyage implementation.

## 1. Move Open Sea Events Into Table Data

Status: Not Started

Goal:

Represent Open Sea Events as structured data rather than hardcoded control flow where possible.

Possible event data fields:

- roll range.
- event name.
- DM-facing description.
- player-facing description, if needed.
- whether the event requires confirmation.
- whether the event creates prompts.
- whether the event modifies state.
- whether the event blocks normal turn flow.

Reason:

This is the foundation for reusable event tables, presets, and future custom scenarios.

## 2. Built-In Event Table Selector

Status: Not Started

Goal:

Allow the DM to choose a built-in event table during setup or preset selection.

Possible built-in tables:

- Marrowwind Open Sea.
- Generic Open Sea.
- Calm Coastal Waters.
- Stormy Waters.

Keep the first version simple. Do not build a custom event-table editor yet.

## 3. Custom Event Table Editor

Status: Future

Goal:

Allow a DM to define their own event table.

Possible future fields:

- d20 range.
- event title.
- event text.
- mechanical tags.
- prompt creation.
- state effects.

This is likely a larger publishability feature, not a near-term cleanup task.

---

# Next Feature Phase: Player View and Presentation

The player view works. The next presentation work should make it clearer and more atmospheric without making the tracker distracting.

## 1. Time-of-Day Visual Themes

Status: Not Started

Goal:

Change the player view's visual atmosphere based on the current time of day or voyage phase.

Possible phases:

- morning.
- afternoon.
- evening.
- night.
- storm or scripted crisis.

Implementation direction:

- Add a computed time phase to the published player state.
- Add a class or data attribute to the player page, such as `data-time-phase="night"`.
- Use CSS to adjust background, panel glow, and accent colors.
- Keep DM screen styling mostly stable.

Reason:

This creates a visual sense of passage and helps the player view feel more alive.

## 2. Turn-Advance Overlay

Status: Not Started

Goal:

When the DM advances the turn, the player view should briefly show that time has passed.

Possible behavior:

- Show a short overlay on the player view.
- Display something like `Day 1, Turn 1 → Day 1, Turn 2`.
- Optionally include a simple clock/wheel animation.
- Keep the overlay short and non-blocking.
- Do not cover the DM screen with an animation.

Implementation direction:

- Publish previous and current turn labels or a `lastTurnAdvanceId`.
- Let `player_view.js` detect turn changes and trigger the overlay.
- Add `prefers-reduced-motion` support to reduce or skip animation.

Reason:

Turn advancement is currently functional but visually quiet. A short player-facing transition would improve table feel.

## 3. Player View Polish

Status: Not Started

Possible improvements:

- stronger ship-name header.
- clearer travel/water/supply grouping.
- better active-effects layout.
- improved crew status cards.
- more readable projection mode.
- small visual indicators for hidden vs known information.

## 4. Value-Change Feedback

Status: Future

Possible improvements:

- subtle visual flash when water changes.
- subtle visual flash when travel changes.
- subtle visual flash when supplies change.
- log emphasis for major turn results.

Avoid heavy animations. The tracker should remain readable and stable.

## 5. Ship Diagram

Status: Future

Goal:

Add a simple visual ship status diagram.

Possible displayed systems:

- mast.
- rudder.
- pump.
- leaks.
- water level.
- cargo hold threshold.

This should remain simple and should not block more important usability work.

---

# Next Feature Phase: Save and Session Management

The current save/export/import system works, but longer use would benefit from better save management.

## 1. Save Slots

Status: Not Started

Goal:

Allow multiple browser saves instead of one current voyage.

Possible behavior:

- named save slots.
- save timestamp.
- ship name shown in slot list.
- resume selected slot.
- delete slot.
- export selected slot.

This should wait until the current single-save setup flow and demo behavior are fully tested.

## 2. Structured Turn History

Status: Future

Goal:

Improve the activity log into a clearer turn history.

Possible behavior:

- grouped by day/turn.
- actions confirmed.
- event rolled.
- checks resolved.
- water update.
- travel update.
- supplies update.

## 3. Copy Recap Button

Status: Future

Goal:

Generate a short plain-text recap from the latest turn or session segment.

Possible uses:

- DM notes.
- Discord update.
- session recap drafting.

---

# Current Known Feature Backlog

## Temporary Skeleton Helpers

Status: Backlog

Goal:

Represent temporary helper crew or skeleton crew members if the scenario calls for them.

Open questions:

- Do skeleton helpers take normal actions?
- Do they have labor/exhaustion?
- Do they appear on the player screen?
- Are they controlled by the DM only?
- Are they temporary effects instead of crew rows?

This should not be built until the desired table behavior is clear.

---

# Publishable Tool Preparation

These tasks matter if the project moves from personal tool to public tool.

## 1. Rename Public Identity

Status: Future

Current identity:

- Marrowwind Open Sea Tracker.

Possible broader identity:

- Open Sea Encounter Tracker.
- Open Sea Voyage Tracker.
- Dangerous Voyage Tracker.

Reason:

The current name is campaign-specific. A public tool should sound reusable.

## 2. Scenario and Rules Documentation

Status: Future

Goal:

Document the rules enough that another DM can use the tracker without knowing the original Marrowwind scenario.

Possible docs:

- basic voyage procedure.
- crew actions reference.
- water/flooding rules.
- travel/Course Meter rules.
- player knowledge rules.
- event table explanation.
- setup/preset explanation.
- demo-mode behavior.

## 3. Product Packaging and Demo Strategy

Status: Future

Goal:

Plan how a future purchasable version would differ from a free demo.

Possible direction:

- Free demo build includes Demo Mode only.
- Full version unlocks setup, save, export/import, presets, and custom tables.
- Demo build intentionally cannot save.
- In a public demo, full-version buttons could be visible but disabled with purchase messaging.
- Paid version should not rely only on disabled client-side buttons for real protection.

Possible distribution models:

- free public GitHub Pages demo plus paid download.
- hosted paid version with account/license check.
- separate demo build and full build.
- desktop/package download through a storefront.

This is a long-term product decision, not a near-term code task.

## 4. Legal/Product Cleanup

Status: Future

If the project becomes public or monetized:

- avoid official D&D branding.
- avoid copied rules text.
- avoid proprietary setting names.
- avoid non-original protected content.
- keep the public framing as an original 5e-compatible encounter tool unless a different license path is chosen.

---

# Not Planned Yet

These are valid ideas, but they should not be built until the current roadmap items are more stable.

- Full scenario builder.
- Custom action-list editor.
- Custom scripted-event editor.
- Custom flooding formula editor.
- Custom ship-system editor.
- Multiplayer/network sync.
- Account system.
- Cloud saves.
- Mobile-first rewrite.
- Framework rewrite.
- Full automated browser testing suite.

---

# Recommended Next Order

Use this order unless a table need forces something else:

1. Run focused manual browser testing.
2. Fix any manual test failures.
3. Keep documentation current as changes land.
4. Add starting presets.
5. Add setup polish that presets require.
6. Move Open Sea Events into structured table data.
7. Add built-in event table selector.
8. Add player-view time-of-day visual themes.
9. Add player-view turn-advance overlay.
10. Improve player view layout/presentation.
11. Add save slots.
12. Improve structured turn history.
13. Add scenario/rules documentation.
14. Plan product packaging and public identity.

---

# Maintenance Rule

Before starting a new feature phase:

1. Run `npm run ci`.
2. Check that GitHub Actions passes.
3. Run the relevant parts of `docs/MANUAL_TESTING.md`.
4. Update this roadmap if the feature changes the plan.
