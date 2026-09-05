# Canvas guide and shedding signal (#27)

The guide now points to incoming flow, cylinder-surface separation, separated
shear layers, roll-up, and alternating shedding. Dashed numbered markers are
explicitly explanatory locations, not detected vortex positions. Their anchors
use the physical domain shared by the two interactive quality tiers.

During adaptation, observation, and completion, a lift-coefficient trace sits
below the wake. Its horizontal axis is flow-through time (D/U); lift coefficient
is dimensionless. A white cursor identifies the visible wake frame. The vertical
scale adapts and is labelled. Lift sign denotes transverse force, not rotation
sign. Completion connects measured periodic lift to St = fD/U and the measured
cycle duration. The existing regime detector and Strouhal estimator remain
authoritative.

## Telemetry contract

Worker protocol v1 gains optional `liftSignal` fields on frame events and
summaries. Older messages without the extension remain readable. Each signal is
a replacement snapshot containing the presented frame's flow-through time and
at most 256 samples from the last 32 D/U. Rendering may skip an advancement;
the signal then stays at the last presented frame. Pause and step flush a frame.
Frame telemetry and pixels share one ordered event. Offscreen rendering uses
the summary's same presented-frame snapshot.

Display history is independent of classification history. It survives an
in-place speed/viscosity adaptation, clears on experiment restart or diameter
change, and is discarded on tier change and Worker recovery. The existing
session/sequence gate rejects old-session and out-of-order telemetry. Numerical
failure freezes the last valid field and signal and suppresses the signal's
physical conclusion.

## Manual checks

Prerequisite: `npm.cmd ci`, then `npm.cmd run dev -- --host 127.0.0.1`; open the
printed local address in Chrome. Select **CPU balanced** for a predictable tier.
Use **Run guided experiment** if the welcome screen was previously dismissed.

1. Start the guide at 1440×900, then inspect at 390×844. Incoming-flow and
   upper/lower surface markers should point to the cylinder region. On mobile,
   the encoding key should sit below the field without covering callouts.
2. Wait for **Baseline measured**, choose a prediction, and commit it. The
   shear-layer and roll-up locations should appear while the existing wake
   adapts. No timer or chart threshold should declare completion.
3. During observation, press **Pause**. The wake and signal cursor should freeze
   together. Press **Step 0.05 D/U**; both should advance once. Resume playback
   and compare alternating wake structures with the oscillating lift trace.
4. At completion, inspect the repeating signal, measured Strouhal value, and
   approximate cycle duration. The display explicitly distinguishes lift sign
   from clockwise/counter-clockwise rotation.
5. Restart the experiment or change quality tier. The old trace should clear.
   Repeat with **WebGPU balanced** on a supported device; step telemetry should
   use the same time and normalization.
6. Enable reduced motion and reload. The guide remains readable with static
   callouts and no interpolated chart animation; tracers start disabled. Pause
   and step provide a static inspection workflow. Navigate actions by keyboard.

Failure handling is covered by injected Worker failure tests and the browser's
WebGPU device-loss test; it does not require deliberately destabilizing the
physical scenario. The signal must show its frozen/unavailable status and must
not endorse a stable physical conclusion after failure.

## Automated coverage

Focused tests cover bounded history, restart, physical adaptation, paired CPU
frame telemetry, sequence/session rejection, tier changes, recovery, and
completion/failure copy. Chrome smoke coverage checks real WebGPU frame
telemetry and restart. The real CPU guide test checks all annotated stages,
mobile key placement, reduced motion, pause/step synchronization, and completion.
Required final commands are `npm.cmd run verify` and `npm.cmd run verify:engine`.
Cross-browser compatibility and a full WebGPU guided run are outside this ticket's
required verification tier.

## Standards review

No documented standard violations were found. Two minor maintainability
findings were resolved: the chart now imports the history limits, and each
annotation keeps its target, badge location, and number in one record.

## Spec review

The review identified narrow-screen axis legibility and failure-state conclusion
copy. Both were corrected. Visual inspection also moved lower callouts clear of
the encoding key and aligned their targets with the shared physical domain.

Final review: zero unresolved findings on either axis.
