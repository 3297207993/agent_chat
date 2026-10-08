//! The two-sided check that `spec/` stays the single source of truth for this crate.
//!
//! `spec/` exists so that JS and Rust make the **same** decisions (docs/design/spec.md). For the code
//! table that means: the key sets are identical in both directions. The JS side already has this test
//! (`packages/host/test/spec.test.ts`); this is its Rust twin, and it is what makes "the crate maps
//! the table instead of inventing codes" a checked fact rather than a promise.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use cambia_plugin_host::error_codes::ErrorCode;
use serde_json::Value;

fn spec_file(name: &str) -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../spec/v1")
    .join(name)
}

fn table() -> Value {
  let text = fs::read_to_string(spec_file("error-codes.json"))
    .expect("spec/v1/error-codes.json must exist: it is the source of the codes");
  serde_json::from_str(&text).expect("the table must be JSON")
}

#[test]
fn error_code_keys_match_the_table_in_both_directions() {
  let in_table: BTreeSet<String> = table()["codes"]
    .as_object()
    .expect("the table has a `codes` object")
    .keys()
    .cloned()
    .collect();

  let in_code: BTreeSet<String> = ErrorCode::ALL
    .iter()
    .map(|code| code.as_str().to_string())
    .collect();

  let missing_in_code: Vec<&String> = in_table.difference(&in_code).collect();
  let missing_in_table: Vec<&String> = in_code.difference(&in_table).collect();

  assert!(
    missing_in_code.is_empty() && missing_in_table.is_empty(),
    "the code table and ErrorCode have drifted:\n  in the table only: {missing_in_code:?}\n  in ErrorCode only: {missing_in_table:?}"
  );
}

#[test]
fn every_code_has_a_known_stage_and_a_summary() {
  // The same shape check the JS side runs. `stage` says which batch implements a code, so an unknown
  // stage means a new layer started reporting spec codes — that must be a deliberate act, not a typo.
  let known_stages: BTreeSet<&str> = ["manifest", "engines", "load", "protocol", "process"]
    .into_iter()
    .collect();

  for (code, entry) in table()["codes"].as_object().unwrap() {
    let stage = entry["stage"].as_str().expect("every code has a stage");
    assert!(
      known_stages.contains(stage),
      "{code} has an unknown stage: {stage}"
    );

    let summary = entry["summary"].as_str().unwrap_or_default();
    assert!(!summary.is_empty(), "{code} has no summary");
  }
}
