EVENT_COMPAT: dict[str, list[str]] = {
    "provisional_desaturation": ["desaturation"],
    "provisional_flow_reduction": [
        "hypopnea",
        "obstructive_apnea",
        "central_apnea",
        "mixed_apnea",
    ],
    "provisional_hypoventilation": ["hypoventilation"],
    "provisional_positional": [],
}
