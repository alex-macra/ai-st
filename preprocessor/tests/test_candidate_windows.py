"""
Synthetic-signal tests for candidate window detectors.
Locks in: position-change detection works, low-quality channels are skipped (not crash),
and the quality floor is per channel rather than a hard artifact_flag gate.
"""
import numpy as np

from candidate_windows import (
    CandidateSet,
    CandidateWindow,
    TAG_OVERLAPS_FLAT,
    TAG_POSITION_ARTIFACT,
    TAG_UNCOUPLED_HYPOPNEA,
    _APNEA_MAGNITUDE_FLOOR,
    _detect_co2_elevation,
    _detect_desaturations,
    _detect_flow_reductions,
    _detect_position_changes,
    _filter_by_spo2_coupling,
    _merge_adjacent_events,
    _post_process_flow_events,
    headline_flow_events,
    tagged_flow_events,
)


def test_position_change_simple_supine_to_left():
    """30s supine (code 1), then 30s left (code 2) at 1Hz."""
    sig = np.concatenate([np.full(60, 1.0), np.full(60, 2.0)])
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert len(transitions) == 1
    start, end, mag = transitions[0]
    assert start == 60.0
    assert mag == 1.0
    assert end > start


def test_position_change_brief_blip_ignored():
    """A 2-sample blip should not count - both runs need to be ≥ min_stable_sec."""
    sig = np.concatenate([np.full(60, 1.0), np.full(2, 3.0), np.full(60, 1.0)])
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_position_constant_value_no_transitions():
    sig = np.full(600, 1.0)
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_position_too_short_recording_returns_empty():
    sig = np.array([1.0, 1.0, 2.0])
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_position_change_empty_signal():
    """Empty signal should return no transitions."""
    sig = np.array([])
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_position_change_single_position():
    """Single position value should not create transitions."""
    sig = np.full(300, 1.0)
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_position_change_rapid_oscillation():
    """Rapid position changes below min_stable_sec should all be ignored."""
    sig = np.array([1.0, 2.0, 1.0, 2.0, 1.0, 2.0] * 100)
    transitions = _detect_position_changes(sig, sample_rate=1.0, min_stable_sec=30.0)
    assert transitions == []


def test_desaturation_detected():
    """Baseline 97%, drops to 92% for 10s (40 samples) at 4Hz."""
    sig = np.full(400, 97.0)
    sig[100:140] = 92.0  # starts at 25.0s, ends at 35.0s
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert len(desats) == 1
    start, end, nadir = desats[0]
    assert 24.0 <= start <= 26.0   # 100 samples / 4 Hz = 25.0 s
    assert 34.0 <= end <= 36.0     # 140 samples / 4 Hz = 35.0 s
    assert 4.5 <= nadir <= 5.5     # baseline 97 − min 92 = 5.0 pp drop


def test_desaturation_too_short_ignored():
    """A 2s drop should be filtered out by min_duration_sec=5."""
    sig = np.full(400, 97.0)
    sig[100:108] = 90.0
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert desats == []


def test_desaturation_ignores_sensor_dropout_negative():
    """A sensor dropout encoded as a negative value must NOT produce a phantom desat."""
    sig = np.full(400, 97.0)
    sig[100:140] = -4.0  # 10s of synthetic sensor dropout
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert desats == []


def test_desaturation_ignores_sensor_dropout_zero():
    """A dropout encoded as 0 must not produce a 97% desat."""
    sig = np.full(400, 97.0)
    sig[100:140] = 0.0
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert desats == []


def test_desaturation_real_drop_still_detected_around_dropout():
    """A real drop adjacent to a dropout must still be detected."""
    sig = np.full(400, 97.0)
    sig[100:140] = -4.0   # dropout
    sig[200:240] = 92.0   # real 5% desat
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert len(desats) == 1
    assert 4.8 <= desats[0][2] <= 5.2


def test_desaturation_empty_signal():
    """Empty signal should return no desaturations."""
    sig = np.array([])
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert desats == []


def test_desaturation_all_nans():
    """Signal of all NaNs should return no desaturations."""
    sig = np.full(400, np.nan)
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert desats == []


def test_desaturation_high_sample_rate_short_drop_ignored():
    """A 4s drop at 100Hz is below min_duration_sec=5 and must be ignored."""
    sig = np.full(4000, 97.0)
    sig[1000:1400] = 92.0  # 4s at 100Hz
    desats = _detect_desaturations(sig, sample_rate=100.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert len(desats) == 0


# ---------------------------------------------------------------------------
# CO2 elevation detection (pediatric hypoventilation)
# ---------------------------------------------------------------------------

def test_co2_elevation_detected():
    """CO2 55 mmHg for 60s at 1Hz: one window with ~5 mmHg elevation."""
    sig = np.concatenate([np.full(120, 40.0), np.full(60, 55.0), np.full(120, 40.0)])
    windows = _detect_co2_elevation(sig, sample_rate=1.0, threshold_mmhg=50.0, min_duration_sec=30.0)
    assert len(windows) == 1
    start, end, elev = windows[0]
    assert 119.0 <= start <= 121.0
    assert 179.0 <= end <= 181.0
    assert 4.5 <= elev <= 5.5  # 55 − 50 = 5 mmHg


def test_co2_elevation_too_short_ignored():
    """A 10s elevation below min_duration_sec=30 must not be reported."""
    sig = np.concatenate([np.full(120, 40.0), np.full(10, 55.0), np.full(120, 40.0)])
    windows = _detect_co2_elevation(sig, sample_rate=1.0, threshold_mmhg=50.0, min_duration_sec=30.0)
    assert windows == []


def test_co2_elevation_dropout_masked():
    """Values outside 20–80 mmHg are sensor dropout and must not trigger a window."""
    sig = np.full(300, 40.0)
    sig[100:160] = 0.0  # 60s of dropout encoded as 0
    windows = _detect_co2_elevation(sig, sample_rate=1.0, threshold_mmhg=50.0, min_duration_sec=30.0)
    assert windows == []


def test_co2_elevation_open_at_end_of_signal():
    """An elevation that runs to the end of the signal must still be captured."""
    sig = np.concatenate([np.full(120, 40.0), np.full(60, 55.0)])  # last 60s elevated
    windows = _detect_co2_elevation(sig, sample_rate=1.0, threshold_mmhg=50.0, min_duration_sec=30.0)
    assert len(windows) == 1
    assert windows[0][2] > 0


def test_co2_elevation_empty_signal():
    windows = _detect_co2_elevation(np.array([]), sample_rate=1.0)
    assert windows == []


# ---------------------------------------------------------------------------
# Pediatric flow-reduction thresholds
# ---------------------------------------------------------------------------

def test_flow_reduction_5s_detected_with_peds_params():
    """A 5s cessation: peds 4s envelope blurs it to ~6.4s → passes 6s peds minimum."""
    sr = 10.0
    sig = np.full(int(sr * 200), 10.0)
    sig[int(sr * 100):int(sr * 105)] = 0.1  # 5s near-zero flow at t=100s
    windows = _detect_flow_reductions(
        sig, sr, min_duration_sec=6.0, threshold_pct=0.3, envelope_sec=4.0
    )
    assert len(windows) >= 1


def test_flow_reduction_5s_missed_with_adult_params():
    """Same 5s cessation: adult 10s envelope blurs it to ~8.8s → below 10s adult minimum."""
    sr = 10.0
    sig = np.full(int(sr * 200), 10.0)
    sig[int(sr * 100):int(sr * 105)] = 0.1
    windows = _detect_flow_reductions(
        sig, sr, min_duration_sec=10.0, threshold_pct=0.3, envelope_sec=10.0
    )
    assert len(windows) == 0


# ---------------------------------------------------------------------------
# CandidateSet cohort field
# ---------------------------------------------------------------------------

def test_candidate_set_default_cohort_is_adult():
    cs = CandidateSet(windows=[], channels_used=[], channels_missing=[])
    assert cs.cohort == "adult"


def test_candidate_set_accepts_pediatric_cohort():
    cs = CandidateSet(windows=[], channels_used=[], channels_missing=[], cohort="pediatric")
    assert cs.cohort == "pediatric"


# ---------------------------------------------------------------------------
# P1: AASM 1B SpO2 coupling - hypopneas without nearby desat are rejected
# ---------------------------------------------------------------------------

def _flow(start: float, end: float, mag: float = 0.5) -> CandidateWindow:
    return CandidateWindow(start_sec=start, end_sec=end, label="provisional_flow_reduction",
                           channel="Flow", magnitude=mag)


def _desat(start: float, end: float, mag: float = 4.0) -> CandidateWindow:
    return CandidateWindow(start_sec=start, end_sec=end, label="provisional_desaturation",
                           channel="SpO2", magnitude=mag)


def test_coupling_rejects_flow_event_with_no_nearby_desat():
    flows = [_flow(100, 115)]
    desats = [_desat(500, 510)]
    coupled, uncoupled = _filter_by_spo2_coupling(flows, desats)
    assert coupled == []
    assert len(uncoupled) == 1


def test_coupling_accepts_flow_event_with_desat_ending_within_30s():
    flows = [_flow(100, 115)]
    desats = [_desat(120, 130)]  # ends 15s after flow event end → within 30s post window
    coupled, _ = _filter_by_spo2_coupling(flows, desats)
    assert len(coupled) == 1


def test_coupling_accepts_desat_ending_just_before_flow_end():
    """A desat ending up to 5s before the flow event end still couples (pre window)."""
    flows = [_flow(100, 115)]
    desats = [_desat(108, 112)]  # ends 3s before flow end
    coupled, _ = _filter_by_spo2_coupling(flows, desats)
    assert len(coupled) == 1


def test_coupling_passes_through_when_no_desat_data():
    """No SpO2 data → the rule cannot be applied; all events fall to 'uncoupled' bucket."""
    flows = [_flow(100, 115), _flow(200, 215)]
    coupled, uncoupled = _filter_by_spo2_coupling(flows, [])
    assert coupled == []
    assert len(uncoupled) == 2


def test_post_process_apneas_bypass_coupling():
    """An apnea (≥90% reduction) without a nearby desat must still be untagged."""
    apnea = _flow(100, 115, mag=_APNEA_MAGNITUDE_FLOOR + 0.01)
    hypopnea = _flow(200, 215, mag=0.4)
    desats = [_desat(220, 230)]  # only the hypopnea is coupled
    out, stats = _post_process_flow_events([apnea, hypopnea], desats, flat_intervals=[])
    assert len(out) == 2
    assert all(TAG_UNCOUPLED_HYPOPNEA not in e.notes for e in out)
    assert stats["headline_count"] == 2


def test_post_process_uncoupled_hypopnea_tagged_not_dropped():
    """Uncoupled hypopneas stay in the candidate set so the validation scorer sees them,
    but get a tag so the headline AHI excludes them."""
    hypopnea = _flow(100, 115, mag=0.4)
    desats = [_desat(500, 510)]
    out, stats = _post_process_flow_events([hypopnea], desats, flat_intervals=[])
    assert len(out) == 1
    assert TAG_UNCOUPLED_HYPOPNEA in out[0].notes
    assert stats["tagged_uncoupled_hypopnea"] == 1
    assert stats["headline_count"] == 0
    assert headline_flow_events(out) == []


# ---------------------------------------------------------------------------
# P2: flat-interval gating
# ---------------------------------------------------------------------------

def test_post_process_tags_flow_event_overlapping_flat_interval():
    """Flat-overlap events stay in candidates (so the scorer still sees them) but
    get a tag - they're excluded from the headline count via headline_flow_events."""
    flow = _flow(100, 115, mag=0.4)
    desats = [_desat(110, 120)]
    out, stats = _post_process_flow_events([flow], desats, flat_intervals=[(105.0, 130.0)])
    assert len(out) == 1
    assert TAG_OVERLAPS_FLAT in out[0].notes
    assert stats["tagged_artifact"] == 1
    assert stats["headline_count"] == 0
    assert headline_flow_events(out) == []


def test_post_process_keeps_flow_event_outside_flat_interval():
    flow = _flow(100, 115, mag=0.4)
    desats = [_desat(110, 120)]
    out, stats = _post_process_flow_events([flow], desats, flat_intervals=[(500.0, 600.0)])
    assert len(out) == 1
    assert TAG_OVERLAPS_FLAT not in out[0].notes
    assert stats["headline_count"] == 1


# ---------------------------------------------------------------------------
# P4: event merge - adjacent events <10s apart collapse
# ---------------------------------------------------------------------------

def test_merge_disabled_by_default_keeps_adjacent_events_separate():
    """With the IoU-based scorer, merging two real adjacent events converts both
    into FN+FP. Default _FLOW_MERGE_GAP_SEC = 0 disables merging entirely."""
    a = _flow(100, 110)
    b = _flow(112, 122)
    merged = _merge_adjacent_events([a, b])
    assert len(merged) == 2


def test_merge_explicit_window_collapses_close_events():
    """When called with an explicit gap, merging still works (kept for callers
    that want it)."""
    a = _flow(100, 110)
    b = _flow(112, 122)
    merged = _merge_adjacent_events([a, b], max_gap_sec=3.0)
    assert len(merged) == 1
    assert merged[0].end_sec == 122


def test_merge_explicit_window_takes_max_magnitude():
    a = _flow(100, 110, mag=0.4)
    b = _flow(112, 122, mag=0.7)
    merged = _merge_adjacent_events([a, b], max_gap_sec=3.0)
    assert merged[0].magnitude == 0.7


# ---------------------------------------------------------------------------
# P5: amplitude floor - phantom events on near-flatlined regions are skipped
# ---------------------------------------------------------------------------

def test_amplitude_floor_can_be_enabled_via_param():
    """When explicitly enabled, the amplitude floor skips events whose local envelope
    is below the floor. Disabled by default to avoid cutting real apneas (which
    also drive envelope near zero) - see _AMPLITUDE_FLOOR_FRAC docstring."""
    sr = 10.0
    sig = np.full(int(sr * 300), 10.0)
    sig[int(sr * 90):int(sr * 200)] = 0.05
    windows = _detect_flow_reductions(
        sig, sr, min_duration_sec=10.0, threshold_pct=0.3, envelope_sec=10.0,
        amplitude_floor_frac=0.05,
    )
    assert windows == []


def test_default_amplitude_floor_does_not_skip_real_apnea():
    """A real apnea drops local envelope near zero. Default behavior must not reject it."""
    sr = 10.0
    sig = np.full(int(sr * 300), 10.0)
    sig[int(sr * 90):int(sr * 110)] = 0.0  # 20s of true apnea
    windows = _detect_flow_reductions(
        sig, sr, min_duration_sec=10.0, threshold_pct=0.3, envelope_sec=10.0,
    )
    assert len(windows) >= 1


# ---------------------------------------------------------------------------
# End-of-signal event capture (previously silently dropped)
# ---------------------------------------------------------------------------

def test_flow_reduction_open_at_end_of_signal():
    """A flow reduction still active at the last sample must be captured."""
    sr = 10.0
    sig = np.full(int(sr * 300), 10.0)
    sig[int(sr * 280):] = 0.0  # 20s of near-zero flow at the very end
    windows = _detect_flow_reductions(
        sig, sr, min_duration_sec=10.0, threshold_pct=0.3, envelope_sec=10.0,
    )
    assert len(windows) >= 1
    # The captured event should end at roughly the end of the recording
    assert windows[-1][1] > int(sr * 285) / sr


def test_desaturation_open_at_end_of_signal():
    """A desaturation still active on the last sample must be captured."""
    sig = np.full(400, 97.0)
    sig[360:] = 92.0  # 10s drop right at the end (at 4 Hz, 400 samples = 100s)
    desats = _detect_desaturations(sig, sample_rate=4.0, drop_threshold=3.0, min_duration_sec=5.0)
    assert len(desats) >= 1
    assert desats[-1][1] >= 99.0  # end_sec should be near the end of the 100s recording


# ---------------------------------------------------------------------------
# tagged_flow_events — complement of headline_flow_events
# ---------------------------------------------------------------------------

def _flow_w(start: float, end: float, notes: list[str] | None = None) -> CandidateWindow:
    return CandidateWindow(start_sec=start, end_sec=end, label="provisional_flow_reduction",
                           channel="Flow", magnitude=0.5, notes=notes or [])


def test_tagged_flow_events_is_complement_of_headline() -> None:
    """headline + tagged must partition the full flow event list with no overlap."""
    events = [
        _flow_w(10, 25),
        _flow_w(30, 45, notes=[TAG_UNCOUPLED_HYPOPNEA]),
        _flow_w(60, 75, notes=[TAG_OVERLAPS_FLAT]),
        _flow_w(90, 105),
    ]
    headline = headline_flow_events(events)
    tagged = tagged_flow_events(events)

    assert len(headline) + len(tagged) == len(events), "no events lost"
    assert not set(map(id, headline)) & set(map(id, tagged)), "no overlap"
    assert all(TAG_UNCOUPLED_HYPOPNEA not in e.notes and TAG_OVERLAPS_FLAT not in e.notes
               for e in headline)
    assert all(TAG_UNCOUPLED_HYPOPNEA in e.notes or TAG_OVERLAPS_FLAT in e.notes
               for e in tagged)


def test_tagged_flow_events_empty_when_no_rejections() -> None:
    events = [_flow_w(10, 25), _flow_w(50, 65)]
    assert tagged_flow_events(events) == []


def test_headline_flow_events_empty_when_all_tagged() -> None:
    events = [
        _flow_w(10, 25, notes=[TAG_UNCOUPLED_HYPOPNEA]),
        _flow_w(50, 65, notes=[TAG_OVERLAPS_FLAT]),
    ]
    assert headline_flow_events(events) == []
    assert len(tagged_flow_events(events)) == 2


# ── Position-artifact tag ────────────────────────────────────────────────────

def test_position_artifact_tagged_within_proximity() -> None:
    # Flow event starts 5 s after a position transition → should be tagged.
    flow = _flow_w(105, 120)
    out, stats = _post_process_flow_events(
        [flow], [], flat_intervals=[], position_transition_secs=[100.0]
    )
    assert TAG_POSITION_ARTIFACT in out[0].notes
    assert stats["tagged_position_artifact"] == 1


def test_position_artifact_not_tagged_outside_proximity() -> None:
    # Flow event starts 30 s after the only transition → outside ±10 s window.
    flow = _flow_w(130, 145)
    out, stats = _post_process_flow_events(
        [flow], [], flat_intervals=[], position_transition_secs=[100.0]
    )
    assert TAG_POSITION_ARTIFACT not in out[0].notes
    assert stats["tagged_position_artifact"] == 0


def test_position_artifact_no_transitions_no_tag_no_error() -> None:
    # No position events passed → tag absent, no KeyError on stats.
    flow = _flow_w(50, 65)
    out, stats = _post_process_flow_events(
        [flow], [], flat_intervals=[], position_transition_secs=None
    )
    assert TAG_POSITION_ARTIFACT not in out[0].notes
    assert stats["tagged_position_artifact"] == 0
