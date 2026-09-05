# Canvas-first instrument layout

Issue: [#28](https://github.com/barnabyg/cfdVisualise/issues/28).

The wake precedes the guide introduction. Learning readouts and primary playback
actions sit above the full-domain canvas, outside the simulated field. The encoding
key sits below it. Desktop keeps physical editing alongside the wake; tablet and
mobile put the controls after the guide. The baseline comparison shares the wake
column, with its still and baseline/live measurements side by side on wider screens
and stacked on mobile.

Advanced controls use native `details`/`summary`. The collapsed summary reports the
active tier, target playback rate, and tracer state. Closing a disclosure keeps its
controls mounted and preserves their values; its open state lasts for the current
page session. Method and validation retains its independent disclosure and visible
evidence status. Neither disclosure stores a preference across page reloads.

The shared visual convention remains blue for negative clockwise rotation, dark
neutral at zero, and orange for positive counter-clockwise rotation. CPU and WebGPU
use brighter endpoints (`#63a9df` and `#df995c`) with similar luminance. The fixed
normalized scale remains −2 to +2; the key adds signed endpoints and a zero marker.
Forced-colour mode retains the palette swatch and direction text. This is an
accessible interpretation, not a nonvisual reconstruction of the flow field.

## Visual and interaction checks

Run `npm.cmd run dev -- --host 127.0.0.1`, then open the printed local URL. Use a
fresh browser session or select **Run guided experiment** for a returning learner.
Use 1440×900, 1024×768, and 390×844 viewports. With reduced motion enabled the
experiment starts paused with tracers off; explicitly start the guide to advance.

| State | Action and expected result |
| --- | --- |
| Initial | The full, undistorted canvas and playback actions fit in the initial viewport. Readouts remain outside the wake. No horizontal page scroll. Physical editing is to the right on desktop and below on tablet/mobile. |
| Prediction | Start the guide and wait for **Baseline measured**. The frozen baseline and paired baseline/live readouts are readable. Select a prediction by keyboard or touch, then commit it. |
| Observing | Wait for **Watching for measured shedding**. The lift trace and current sample are readable. Pause freezes both wake time and signal; Step advances them together. |
| Completed | Wait for **Prediction compared**. Stable periodic lift supports the regime and Strouhal readouts. Baseline and live measurements remain distinguishable; **Run guide again** remains available. |
| Failure | The browser device-loss test injects a lost WebGPU device. **Result unavailable** and explicit restart actions appear above the frozen wake, outside collapsed controls. CPU recovery removes the failure and starts a validated experiment. |
| Disclosures | Open Advanced controls with Enter/Space, change rate and tracers, close and reopen it. Values persist and the summary reflects them while closed. Method and validation opens independently and retains its visible evidence status while closed. |
| Accessibility | Tab through playback, encoding controls, guide, and physical controls. Focus is visible, controls have at least 44px interaction rows, and no essential label depends on hover. Repeat with forced colours and reduced motion. |

`tests/browser/instrument-layout.e2e.ts` exercises the three initial viewport sizes,
sandbox edits, playback, keyboard disclosure use, retained settings, evidence, and
forced colours. It produces initial and high-contrast screenshots. The real CPU
guide test captures prediction, observing, and completion at desktop/mobile widths;
the device-loss test captures failure views and exercises mobile CPU recovery.
Playwright artifacts are written under `test-results/` and are intentionally ignored.

## Verification scope

Use `npm.cmd run verify` for the merge gates and `npm.cmd run verify:engine` for
the palette change and real guided flow. Regenerate quality-tier evidence with
`npm.cmd run validate:quality-tiers` because the WebGPU shader shares a locked
validation input file. No physics, regime thresholds, protocol, saved-data format,
quality-tier range, or verification workflow changes are intended.

The checks use installed Chrome, including software-backed WebGPU. Cross-browser
compatibility and a manual screen-reader session are outside this verification run.

## Results for this change

- Scientific evidence regeneration passed. Both generated manifests matched their
  previous contents; only the validation input fingerprint changed.
- `npm.cmd run verify:engine` passed all six stages: 113 tests across 35 Vitest
  files, evidence freshness, build, 13 browser checks, and the real CPU guide.
  The guided flow completed in 89.55 seconds against the existing 90-second gate.
- The final `npm.cmd run verify` also passed all five stages without warnings.
- Visual inspection covered initial desktop/tablet/mobile, prediction desktop,
  observing mobile, completed desktop/mobile, and mobile failure screenshots.
  The final responsive browser assertions also passed at 1440×900, 1024×768,
  and 390×844, including width, viewport fit, domain aspect ratio, and overflow.
- Standards review found no actionable issues. Spec review found a tablet-size
  regression during implementation; the heading/playback row and stronger size
  assertions resolved it. The final review has no remaining findings.

On the final layout the 900px-tall desktop canvas is approximately 809px wide,
versus the former 660px cap. The 768px-tall tablet canvas is approximately 646px,
versus approximately 607px previously. The full physical domain stays visible.
