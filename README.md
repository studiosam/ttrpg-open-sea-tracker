# Marrowwind Open Sea Tracker

A browser-based tracker for running the Marrowwind open sea voyage rules. The DM screen manages turn flow, actions, checks, water, supplies, ship systems, and hidden state. The player screen shows only player-facing information and updates automatically from the DM screen.

## Files

- `open_sea_tracker.html` - DM-facing tracker.
- `player_view.html` - player-facing display for a second monitor.
- `tracker.js` - DM tracker logic and saved state.
- `player_view.js` - player screen rendering and sync logic.
- `styles.css` - shared styling for both screens.
- `design_document.txt` - system design notes and turn structure.
- `MarrowWindActions.txt` - current action reference.

## Quick Start

1. Open `open_sea_tracker.html` in a browser on the DM monitor.
2. Open `player_view.html` in another tab or browser window on the player-facing monitor.
3. Keep both pages in the same browser profile so they share `localStorage`.
4. Run the game from the DM screen. The player screen updates automatically as the DM tracker changes.

No server or build step is required.

## Recommended Screen Setup

- Put `open_sea_tracker.html` on the DM/private monitor.
- Put `player_view.html` fullscreen on the player-facing monitor.
- If the player screen does not update, refresh `player_view.html` once after opening the DM tracker.

## DM Turn Flow

Use the `Turn Flow` panel on the DM screen. It walks through the current turn in order:

1. Check scripted/start-turn events.
2. Roll or manually enter the Open Sea Event d20 result.
3. Confirm the Open Sea Event.
4. Set each character's action.
5. Resolve required checks and saves.
6. Apply the water update.
7. Advance the turn.

The visible DM panels change based on the current step so the screen only shows what is needed for that part of the turn.

## Setting Crew Actions

- Use each character's action dropdown in the `Crew` panel.
- Confirm characters individually when ready.
- Confirming a character immediately applies labor and creates any required prompts.
- Actions that require two players cannot be confirmed until the required participants are selected.
- Ongoing multi-turn work is automatically selected on following turns.
- Use `Clear` on a character row to clear that character's planned action.
- Use `Clear Plan` to clear all planned actions.

## Checks, Saves, and Prompts

The `Required Checks` area displays prompts created by events, actions, labor thresholds, meals, rest, and water effects.

- Resolve prompts before advancing past their turn-flow step.
- Some prompts reveal information to the player screen when resolved successfully.
- Manual prompts exist when the DM needs to apply a rule result outside the tracker.

## Scoreboard

The DM scoreboard stays visible while running turns. It shows key reference values such as:

- Day and turn
- Water level
- Food and fresh water
- Repair supplies
- Minimum ingress and total ingress
- Active leaks
- Travel remaining
- Ship systems
- Active water effects
- Pending checks

Most scoreboard values have manual `+` and `-` controls so the DM can override state when needed.

## Water and Flooding

Water level is tracked on both screens.

- The player screen shows a large water meter.
- If water is below the cargo hold and the players have not checked the bilge sounding rod, the player screen shows that the level is safe but exact level is unknown.
- Once water reaches the cargo hold, the player screen automatically shows the current level.
- Flooding effects are shown on both screens when active.
- Total ingress is revealed to players only after they know the current water level for two turns in a row.

## Night Overtime

At nighttime, the tracker checks dinner first, then the DM can either stop to rest or start Night Overtime.

- Use `Start Night Overtime` if the crew keeps working after the scheduled rest point.
- Normal turns continue while Night Overtime is active.
- Water still updates, actions still work, and Open Sea Events can still be rolled.
- At the end of each overtime turn, characters with confirmed non-idle actions receive Constitution save prompts.
- Failed overtime saves add visible Exhaustion and tracked overtime Exhaustion.
- Use `End Night Overtime and Rest` when the crew finally stops.
- Breakfast resolves overnight recovery: dinner + breakfast recovers 3 Labor and clears overtime Exhaustion; dinner only recovers 1 Labor and clears overtime Exhaustion; breakfast only recovers 2 Labor and clears 1 overtime Exhaustion; neither recovers 1 Labor and prompts Constitution saves starting at DC 15, +2 per consecutive day without meals, with no cap.
- Standard day/night timing happens after Turn 8.

## Dev Validator

The DM screen includes a collapsed `Dev Validator` panel near the top of the page. Use `Run Dev Validator` after rule changes to check key scripted turns, action durations, Open Sea Event skips, wreckage availability, and no-meal save DCs without changing the current game state.

## Player Knowledge

Some player-facing values start unknown and display as `?` until learned in play.

Players can learn values through actions such as:

- `Study Map` - reveals travel remaining.
- `Inventory Food` - reveals food.
- `Inventory Water` - reveals fresh water.
- `Inventory Repair Supplies` - reveals repair supplies.
- `Examine Bilge Sounding Rod` - reveals water level. If water level is known for two turns in a row, total ingress becomes known.

The DM can also manually reveal or hide values from the scoreboard controls.

## Player Screen

The player screen displays:

- Voyage day and turn
- Travel remaining, if known
- Water level meter
- Active leaks
- Total ingress, if known
- Supplies, if known
- Ship systems
- Crew labor, exhaustion, and most recent action
- Active effects
- Ongoing work

The player screen does not show DM-only information such as minimum ingress.

## Saving and Refreshing

The tracker uses browser `localStorage`.

- Use `Undo` to restore the state from before the last meaningful change.
- The app keeps the 20 most recent undo snapshots for the current page session.
- The DM state is saved automatically as phases advance.
- Use `Save` on the DM screen to manually save the full tracker state.
- Use `Load` to reload saved state.
- Use `Export` to download the current tracker state as a `.json` backup file.
- Use `Import` to restore a previously exported `.json` backup file.
- Use `Reset` only when you want to start over.

Important: saved data is tied to the browser profile and local files. If you switch browsers, clear site data, or use a private window, saved state may not be available.

Exported files go to the browser's normal download location, usually the Downloads folder unless your browser asks where to save each file.
Import replaces the current tracker state with the selected file, but `Undo` can restore the state from before the import during the same page session.

## Activity Log

The activity log appears at the bottom of the DM page. It records human-readable events such as:

- Confirmed actions
- Labor changes
- Repairs completed
- Supplies spent
- Open Sea Events resolved
- Turn advancement

Use it to audit what happened if you need to check whether something was already applied.

## Troubleshooting

- Player screen is blank: open `open_sea_tracker.html` first, then refresh `player_view.html`.
- Player screen is not updating: make sure both pages are open in the same browser profile.
- Saved state is missing: check that the browser did not clear local site data.
- Layout looks wrong: use a modern desktop browser and fullscreen the player view on a 16:9 display.
- A rule result needs correction: use the DM scoreboard override controls and the activity log to document the correction.
