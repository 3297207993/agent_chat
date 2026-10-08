//! The Rust side of Cambia: everything that must outlive the WebView or needs OS privileges.
//!
//! Scope, and why the split is where it is: the ports the host needs are declared on the TS side
//! (`@cambia/host`, docs/design/host.md) and implemented here, with the Tauri adapter layer in
//! between. The rule that decides a port's side is written down once — "whatever must outlive the
//! WebView, or needs OS privileges, or has to cross CSP, is Rust" — and this crate is the Rust
//! answer: `.tap` packing and unpacking (the only implementation), sha256, download, atomic install
//! and journal recovery, the installation directory as the single authority on what is installed,
//! backend process supervision and the control-plane transport (docs/design/plugin-host.md).
//!
//! Two hard rules hold this crate in place:
//!
//! - **No Tauri symbols, ever** (CONTRIBUTING hard rule 3). That is why it can be covered by plain
//!   `cargo test` and reused by non-Tauri hosts, and why the adapter layer may depend on it but never
//!   the other way round (kernel.md 5.1).
//! - **No kernel semantics.** Loading, activation verdicts, diagnostics and timeouts live in
//!   `@cambia/host`; orchestrating *when* to install or start something is the host application's
//!   policy. The one piece inherited from the TS side is the error-code table, whose values stay in
//!   `spec/v1/error-codes.json` (spec.md).
//!
//! What is live today: [`error_codes`] (the Rust mirror of the shared table, with the two-sided drift
//! check in `tests/spec.rs`), [`platform`] (the spec's `<os>-<arch>` vocabulary) and [`protocol`] (the
//! control plane's frames and messages, spec/v1/protocol.md). Still to come: K2.5 (packing, hashing,
//! download, atomic install, journal) and the rest of K2.6 (the process supervisor and its transport).
//!
//! ```text
//! src/error_codes.rs  the code table          (spec/v1/error-codes.json)
//! src/platform.rs     <os>-<arch> -> OS/ARCH
//! src/protocol.rs     frames, messages, id rules (spec/v1/protocol.md)
//! ```

#![warn(missing_docs)]

pub mod error_codes;
pub mod platform;
pub mod process;
pub mod protocol;
pub mod transport;
