# Pickleball 3D TODO

Feature and gameplay follow-ups after the character-chooser documentation cleanup.

- [ ] **Complete Mixamo animation states.** Add `idle`, `ready`, `run`, and a real
  underhand pickleball `serve`; the active roster currently has only
  forehand/backhand/overhead swing clips.
- [ ] **Calibrate visual contact frames.** Scrub and retime swing clips so true
  paddle contact lands at `contactT = 0.5` inside the 0.44 s visual swing.
- [ ] **Improve team/role identity.** Add readable team/slot distinction for fixed,
  non-customizable Mixamo characters beyond swatches, paddles, rings, and the
  current placeholder headband direction.
- [ ] **Run a human-input feel pass.** Specifically test swing timing, whiffs,
  aim, poaching, touch shots, and mobile gestures; AI-vs-AI tooling does not
  cover the most important human feel contract.
- [ ] **Add rally-pattern telemetry.** Measure whether matches preserve the
  intended serve deep -> return deep -> third-shot drop -> kitchen battle rhythm
  across modes and difficulties.
- [ ] **Tune singles independently.** Validate passing-shot placement, recovery,
  whiff rate, and whether singles feels distinct from lane-based doubles.
- [ ] **Expand practice progression.** Build drills for drive, drop, dink, lob,
  serve, and poach scenarios with goals, streaks, and simple session structure.
- [ ] **Polish specialty-shot presentation.** ATP and Erne logic exists; add clearer
  visual language, especially an Erne leap/landing animation or readable
  stand-in.
- [ ] **Revisit payload/performance budgets.** Lazy player loading is in place, but
  animation/team-identity assets may require code-splitting, stricter asset
  budgets, or LOD/fallback decisions.
