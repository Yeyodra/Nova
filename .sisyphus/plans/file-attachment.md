# File Attachment Feature for enowX-Coder

## TL;DR

> **Quick Summary**: Add comprehensive file attachment to the chatbar — images sent as base64 multimodal content, documents text-extracted and injected as context. Desktop-native approach using Tauri's local filesystem.
> 
> **Deliverables**:
> - Paperclip button → file picker → attach files
> - Drag & drop files onto chat area
> - Paste images from clipboard (Ctrl+V)
> - Multiple files (max 5, max 10MB each)
> - Image compression + base64 encoding in Rust
> - PDF/TXT text extraction in Rust
> - File chips UI with progress + remove
> - Image thumbnails in message history
> - Document content rendered as context block
> - Multimodal API payload (OpenAI + Anthropic formats)
> - Test infrastructure (vitest + cargo test) + TDD
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Test Setup → DB Migration → File Service → Chat Service Multimodal → Frontend Integration

---

## Context

### Original Request
Add file attachment feature to enowX-Coder chatbar, inspired by LobeHub's implementation but adapted for Tauri desktop app architecture.

### Interview Summary
**Key Discussions**:
- Full scope: button click, drag & drop, paste, multiple files, non-image docs, progress UI, image preview in history
- Storage: Local filesystem only (app data dir) — no cloud/S3
- Model capabilities: Always allow attach, let API error if unsupported
- Limits: 10MB per file, 5 files per message
- Tests: Setup vitest + cargo test, TDD approach

**Research Findings (LobeHub deep exploration)**:
- LobeHub uses: Ant Design Upload, zustand file store, S3 presigned URLs, context-engine for multimodal
- For enowX-Coder: simpler desktop approach — local file copy, Rust-side base64 encoding, Tauri asset protocol for serving files to webview
- OpenAI format: `{ type: "image_url", image_url: { url: "data:image/...;base64,..." } }`
- Anthropic format: `{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }`
- Non-image files: text extracted, injected as XML `<file>` blocks in message content

### Metis Review
**Identified Gaps** (addressed):
- Data lifecycle: files persist with message, deleted on message/session delete
- Base64 size: compress images to max 1920px, target <2MB per image after compression
- Anthropic vs OpenAI: both format paths implemented in Rust chat service
- PDF extraction: use `pdf-extract` crate, graceful fallback if extraction fails
- Partial failure: individual file errors don't block others, show per-file error state
- Orphaned files: cleanup on app startup (scan for files without DB references)

---

## Work Objectives

### Core Objective
Enable users to attach images and documents to chat messages, with files processed locally and sent to AI providers in their native multimodal format.

### Concrete Deliverables
- `src-tauri/migrations/YYYYMMDD_attachments.sql` — new attachments table
- `src-tauri/src/services/file_service.rs` — file copy, compress, extract, delete
- `src-tauri/src/commands/file.rs` — Tauri commands for file operations
- `src/stores/useFileStore.ts` — zustand store for attachment state
- `src/components/chat/FileChips.tsx` — file preview chips above input
- `src/components/chat/ImagePreview.tsx` — image thumbnails in message history
- `src/components/chat/FileContext.tsx` — document content display in messages
- `src/components/chat/DragDropZone.tsx` — drag & drop overlay
- Modified `ChatInputBar.tsx` — connected paperclip, paste handler
- Modified `chat_service.rs` — multimodal message construction
- Modified `ChatMessage.tsx` — render attachments in history
- Test infrastructure: `vitest.config.ts`, `src-tauri/tests/`

### Definition of Done
- [ ] `cargo test` passes all file service tests
- [ ] `bunx vitest run` passes all frontend tests
- [ ] User can attach image via button → image appears as chip → send → image visible in message history → LLM receives base64
- [ ] User can drag image onto chat → same flow
- [ ] User can paste screenshot → same flow
- [ ] User can attach PDF → text extracted → sent as context to LLM
- [ ] 5+ files rejected with error message
- [ ] 10MB+ file rejected with error message
- [ ] Delete message → attachment files deleted from disk
- [ ] Delete session → all session attachment files deleted

### Must Have
- Image compression before base64 encoding (max 1920px, target <2MB)
- Both OpenAI and Anthropic multimodal format support
- Graceful error handling (per-file, not all-or-nothing)
- File chips with remove button before send
- Progress indication during processing
- Cleanup on message/session deletion

### Must NOT Have (Guardrails)
- NO cloud storage (S3, CDN, etc.) — local filesystem only
- NO model capability detection/gating — always allow attach
- NO file editing/cropping UI — just attach and send
- NO OCR for scanned PDFs — just warn "no text extracted"
- NO file sharing between sessions — each message owns its files
- NO drag-to-reorder attachments — order doesn't matter
- NO video support — images and documents only
- NO streaming upload progress (files are local, processing is fast)
- NO encryption of stored files — trust local filesystem security

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (needs setup)
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Frontend framework**: vitest + @testing-library/react
- **Backend framework**: cargo test (unit) + integration tests with temp dirs
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — navigate, interact, assert DOM, screenshot
- **Rust backend**: Use Bash (cargo test) — run tests, assert pass
- **Integration**: Use Bash (Tauri dev mode) — invoke commands, verify responses

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — test infra + types + DB + permissions):
├── Task 1: Test infrastructure setup (vitest + cargo test) [quick]
├── Task 2: TypeScript type definitions for attachments [quick]
├── Task 3: DB migration — attachments table [quick]
├── Task 4: Tauri capabilities — grant fs permissions [quick]
├── Task 5: Rust dependencies — image, pdf-extract, base64, mime_guess [quick]
└── Task 6: Frontend dependencies — (none needed, use native APIs) [quick]

Wave 2 (Core services — Rust backend, all parallel):
├── Task 7: Rust file service — copy, compress, base64, delete [deep]
├── Task 8: Rust PDF/TXT extraction service [deep]
├── Task 9: Rust file commands — Tauri IPC layer [quick]
├── Task 10: Rust chat service — multimodal message construction [deep]
└── Task 11: Rust cleanup service — orphan detection, cascade delete [unspecified-high]

Wave 3 (Frontend — store + UI components, all parallel):
├── Task 12: Zustand file store (useFileStore) [unspecified-high]
├── Task 13: FileChips component — preview chips above input [visual-engineering]
├── Task 14: DragDropZone component — overlay + drop handler [visual-engineering]
├── Task 15: ChatInputBar integration — paperclip + paste [unspecified-high]
├── Task 16: ChatMessage attachment rendering — images + docs [visual-engineering]
└── Task 17: Image lightbox/zoom component [visual-engineering]

Wave 4 (Integration + polish):
├── Task 18: End-to-end integration — full flow wiring [deep]
├── Task 19: Error handling + edge cases [unspecified-high]
└── Task 20: Cleanup service integration — delete cascades [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 7,8,10,11,12-17 | 1 |
| 2 | - | 7,8,9,10,11,12,13,15,16 | 1 |
| 3 | - | 7,9,10,11 | 1 |
| 4 | - | 9,14,15 | 1 |
| 5 | - | 7,8,10,11 | 1 |
| 6 | - | 12-17 | 1 |
| 7 | 1,2,3,5 | 9,10,18 | 2 |
| 8 | 1,2,5 | 10,18 | 2 |
| 9 | 2,3,4,7 | 12,15,18 | 2 |
| 10 | 1,2,3,5,7,8 | 18 | 2 |
| 11 | 1,3,5,7 | 20 | 2 |
| 12 | 1,2,6,9 | 13,14,15,18 | 3 |
| 13 | 2,6,12 | 15,18 | 3 |
| 14 | 4,6,12 | 18 | 3 |
| 15 | 4,6,12,13 | 18 | 3 |
| 16 | 2,6 | 18 | 3 |
| 17 | 6 | 18 | 3 |
| 18 | 7-17 | 19,20 | 4 |
| 19 | 18 | F1-F4 | 4 |
| 20 | 11,18 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: **6 tasks** — T1-T6 → `quick`
- **Wave 2**: **5 tasks** — T7 → `deep`, T8 → `deep`, T9 → `quick`, T10 → `deep`, T11 → `unspecified-high`
- **Wave 3**: **6 tasks** — T12 → `unspecified-high`, T13 → `visual-engineering`, T14 → `visual-engineering`, T15 → `unspecified-high`, T16 → `visual-engineering`, T17 → `visual-engineering`
- **Wave 4**: **3 tasks** — T18 → `deep`, T19 → `unspecified-high`, T20 → `quick`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Test Infrastructure Setup

  **What to do**:
  - Install vitest + @testing-library/react + jsdom as dev dependencies
  - Create `vitest.config.ts` with path aliases matching vite.config.ts
  - Create `src/test/setup.ts` with jsdom environment setup
  - Add `"test": "vitest run"` script to package.json
  - Create `src-tauri/tests/` directory for Rust integration tests
  - Write one smoke test per side: `src/stores/useFileStore.test.ts` (empty store init) and `src-tauri/src/services/file_service.rs` (inline `#[cfg(test)]` module with one trivial test)
  - Verify: `bunx vitest run` passes, `cargo test` passes

  **Must NOT do**:
  - No E2E/Playwright setup yet (that's for Final Verification)
  - No test coverage thresholds
  - No CI/CD pipeline

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-6)
  - **Blocks**: Tasks 7, 8, 10, 11, 12-17
  - **Blocked By**: None

  **References**:
  - `vite.config.ts` — path aliases to replicate in vitest config
  - `package.json` — current dev dependencies, scripts section
  - `src-tauri/Cargo.toml` — verify test features enabled
  - `tsconfig.json` — TypeScript paths for vitest resolver

  **Acceptance Criteria**:
  - [ ] `bunx vitest run` → PASS (1 test, 0 failures)
  - [ ] `cargo test` → PASS (1 test, 0 failures)
  - [ ] vitest.config.ts exists with correct path aliases
  - [ ] package.json has vitest + @testing-library/react in devDependencies

  **QA Scenarios**:
  ```
  Scenario: Frontend test runner works
    Tool: Bash
    Steps:
      1. Run `bun install`
      2. Run `bunx vitest run`
      3. Assert exit code 0
      4. Assert output contains "1 passed"
    Expected Result: vitest runs and passes 1 smoke test
    Evidence: .sisyphus/evidence/task-1-vitest-pass.txt

  Scenario: Rust test runner works
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test`
      2. Assert exit code 0
      3. Assert output contains "test result: ok"
    Expected Result: cargo test runs and passes
    Evidence: .sisyphus/evidence/task-1-cargo-test-pass.txt
  ```

  **Commit**: YES
  - Message: `build(test): setup vitest + cargo test infrastructure`
  - Files: `vitest.config.ts`, `package.json`, `src/test/setup.ts`, `src/stores/useFileStore.test.ts`
  - Pre-commit: `bunx vitest run && cd src-tauri && cargo test`

- [x] 2. TypeScript Type Definitions for Attachments

  **What to do**:
  - Add `AttachmentStatus` type: `'pending' | 'processing' | 'ready' | 'error'`
  - Add `AttachmentItem` interface: `{ id: string; messageId?: string; fileName: string; fileSize: number; mimeType: string; filePath: string; previewUrl?: string; base64?: string; extractedText?: string; status: AttachmentStatus; error?: string; }`
  - Add `FileAttachmentConfig` const: `{ MAX_FILE_SIZE: 10 * 1024 * 1024, MAX_FILES: 5, ALLOWED_IMAGE_TYPES: [...], ALLOWED_DOC_TYPES: [...] }`
  - Extend `Message` interface: add optional `attachments?: AttachmentItem[]`
  - Write tests: type assertion tests verifying interface shape

  **Must NOT do**:
  - No runtime validation yet (that's Task 7/9)
  - No Rust types yet (that's separate)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-6)
  - **Blocks**: Tasks 7, 8, 9, 10, 11, 12, 13, 15, 16
  - **Blocked By**: None

  **References**:
  - `src/types/index.ts:17-24` — existing Message interface to extend
  - `src-tauri/src/models/message.rs` — Rust Message struct (must stay in sync)

  **Acceptance Criteria**:
  - [ ] `AttachmentItem` interface exported from `src/types/index.ts`
  - [ ] `FileAttachmentConfig` const exported from `src/types/index.ts` or `src/lib/constants.ts`
  - [ ] `Message` interface has optional `attachments` field
  - [ ] Type test passes: `bunx vitest run src/types/`

  **QA Scenarios**:
  ```
  Scenario: Types compile correctly
    Tool: Bash
    Steps:
      1. Run `bunx tsc --noEmit`
      2. Assert exit code 0
    Expected Result: No TypeScript errors
    Evidence: .sisyphus/evidence/task-2-tsc-pass.txt

  Scenario: Type test passes
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/types/`
      2. Assert exit code 0
    Expected Result: Type assertion tests pass
    Evidence: .sisyphus/evidence/task-2-type-test.txt
  ```

  **Commit**: YES
  - Message: `feat(types): add attachment type definitions`
  - Files: `src/types/index.ts`, `src/lib/constants.ts`, `src/types/attachment.test.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 3. Database Migration — Attachments Table

  **What to do**:
  - Create migration file `src-tauri/migrations/20260520000_attachments.sql`
  - Schema:
    ```sql
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      extracted_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_attachments_message_id ON attachments(message_id);
    ```
  - Create Rust model `src-tauri/src/models/attachment.rs`:
    ```rust
    #[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
    #[serde(rename_all = "camelCase")]
    pub struct Attachment { id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at }
    ```
  - Register in `src-tauri/src/models/mod.rs`
  - Write test: verify migration runs and table exists

  **Must NOT do**:
  - No CRUD service yet (that's Task 7/9)
  - No foreign key to sessions (cascade via messages → attachments)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4-6)
  - **Blocks**: Tasks 7, 9, 10, 11
  - **Blocked By**: None

  **References**:
  - `src-tauri/migrations/20260308000_init.sql` — existing migration pattern (messages table)
  - `src-tauri/src/models/message.rs` — existing model pattern (derives, serde rename)
  - `src-tauri/src/models/mod.rs` — where to register new model
  - `src-tauri/src/lib.rs:88` — migration runner setup

  **Acceptance Criteria**:
  - [ ] Migration file exists at correct path
  - [ ] `cargo test` passes (migration applies cleanly)
  - [ ] Attachment struct compiles with correct derives
  - [ ] ON DELETE CASCADE verified: deleting message deletes attachments

  **QA Scenarios**:
  ```
  Scenario: Migration applies cleanly
    Tool: Bash
    Steps:
      1. Delete test.db if exists
      2. Run `cd src-tauri && cargo test test_migration_attachments`
      3. Assert exit code 0
    Expected Result: Migration creates table, test inserts and queries work
    Evidence: .sisyphus/evidence/task-3-migration-test.txt

  Scenario: Cascade delete works
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_attachment_cascade_delete`
      2. Assert: insert message + attachment, delete message, query attachment returns empty
    Expected Result: Attachment deleted when parent message deleted
    Evidence: .sisyphus/evidence/task-3-cascade-test.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add attachments table migration`
  - Files: `src-tauri/migrations/20260520000_attachments.sql`, `src-tauri/src/models/attachment.rs`, `src-tauri/src/models/mod.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 4. Tauri Capabilities — Grant FS Permissions

  **What to do**:
  - Update `src-tauri/capabilities/default.json` to add fs permissions:
    ```json
    "permissions": [
      "core:default",
      "opener:default",
      "dialog:default",
      "fs:default",
      "fs:allow-read",
      "fs:allow-write",
      "fs:allow-exists",
      "fs:allow-mkdir",
      "fs:allow-remove",
      "fs:allow-rename",
      "fs:scope-app-data"
    ]
    ```
  - Add `@tauri-apps/plugin-fs` to frontend package.json (for potential direct fs access)
  - Verify: app still builds and runs with new permissions

  **Must NOT do**:
  - No broad filesystem access (scope to app-data only)
  - No `fs:allow-*` without scope restriction

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5-6)
  - **Blocks**: Tasks 9, 14, 15
  - **Blocked By**: None

  **References**:
  - `src-tauri/capabilities/default.json` — current permissions (core, opener, dialog only)
  - `src-tauri/Cargo.toml:19` — tauri-plugin-fs already in dependencies
  - `src-tauri/src/lib.rs:21` — plugin already registered

  **Acceptance Criteria**:
  - [ ] `src-tauri/capabilities/default.json` includes fs permissions
  - [ ] `@tauri-apps/plugin-fs` in package.json dependencies
  - [ ] `cargo build` succeeds
  - [ ] App launches without permission errors

  **QA Scenarios**:
  ```
  Scenario: App builds with new permissions
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo build`
      2. Assert exit code 0
    Expected Result: Build succeeds with fs permissions
    Evidence: .sisyphus/evidence/task-4-build-pass.txt
  ```

  **Commit**: YES
  - Message: `build(tauri): grant fs permissions in capabilities`
  - Files: `src-tauri/capabilities/default.json`, `package.json`
  - Pre-commit: `cd src-tauri && cargo build`

- [x] 5. Rust Dependencies — image, pdf-extract, base64, mime_guess

  **What to do**:
  - Add to `src-tauri/Cargo.toml` [dependencies]:
    - `image = "0.25"` — image compression/resize
    - `pdf-extract = "0.7"` — PDF text extraction
    - `base64 = "0.22"` — base64 encoding
    - `mime_guess = "2"` — MIME type detection from file extension
    - `sha2 = "0.10"` — file hashing for dedup (optional but useful)
  - Verify: `cargo build` succeeds with new deps
  - Write smoke test: import each crate, call one trivial function

  **Must NOT do**:
  - No actual service implementation (that's Wave 2)
  - No feature flags or conditional compilation

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4, 6)
  - **Blocks**: Tasks 7, 8, 10, 11
  - **Blocked By**: None

  **References**:
  - `src-tauri/Cargo.toml` — existing dependencies section
  - crates.io docs for each crate

  **Acceptance Criteria**:
  - [ ] All 5 crates in Cargo.toml
  - [ ] `cargo build` succeeds
  - [ ] `cargo test test_deps_smoke` passes

  **QA Scenarios**:
  ```
  Scenario: Dependencies compile
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo build`
      2. Assert exit code 0
      3. Run `cargo test test_deps_smoke`
      4. Assert exit code 0
    Expected Result: All new crates compile and basic imports work
    Evidence: .sisyphus/evidence/task-5-deps-build.txt
  ```

  **Commit**: YES
  - Message: `build(deps): add image, pdf-extract, base64, mime_guess crates`
  - Files: `src-tauri/Cargo.toml`
  - Pre-commit: `cd src-tauri && cargo build`

- [x] 6. Frontend Dependencies Check

  **What to do**:
  - Verify no additional frontend deps needed (native File API, Canvas API, FileReader are built-in)
  - Add `@tauri-apps/plugin-fs` if not already added in Task 4
  - Ensure `@tauri-apps/plugin-dialog` is available (already is)
  - Write a smoke test: `src/lib/fileUtils.test.ts` testing that `FileReader`, `URL.createObjectURL` are available in jsdom (or mock them)

  **Must NOT do**:
  - No heavy image processing libs (browser-image-compression, etc.) — Rust handles compression
  - No PDF.js — Rust handles extraction

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-5)
  - **Blocks**: Tasks 12-17
  - **Blocked By**: None

  **References**:
  - `package.json` — current dependencies
  - Task 4 output — @tauri-apps/plugin-fs addition

  **Acceptance Criteria**:
  - [ ] `@tauri-apps/plugin-fs` in dependencies
  - [ ] Smoke test passes verifying browser APIs available
  - [ ] `bun install` succeeds

  **QA Scenarios**:
  ```
  Scenario: Frontend deps install cleanly
    Tool: Bash
    Steps:
      1. Run `bun install`
      2. Assert exit code 0
      3. Run `bunx vitest run src/lib/fileUtils.test.ts`
      4. Assert exit code 0
    Expected Result: No missing deps, smoke test passes
    Evidence: .sisyphus/evidence/task-6-deps-check.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `build(deps): add @tauri-apps/plugin-fs frontend dependency`
  - Files: `package.json`, `src/lib/fileUtils.test.ts`
  - Pre-commit: `bun install && bunx vitest run`

- [x] 7. Rust File Service — Copy, Compress, Base64, Delete (TDD)

  **What to do**:
  - Create `src-tauri/src/services/file_service.rs`
  - **RED**: Write tests first for each function:
    - `test_copy_file_to_app_data` — copies file to `{app_data}/attachments/{id}/{filename}`
    - `test_compress_image` — resizes to max 1920px, JPEG quality 85, output < 2MB
    - `test_encode_base64` — encodes file to base64 string with data URI prefix
    - `test_delete_attachment` — removes file from disk
    - `test_get_attachment_path` — resolves correct path
    - `test_validate_file_size` — rejects >10MB
    - `test_validate_file_count` — rejects >5 files
  - **GREEN**: Implement:
    - `pub async fn copy_to_attachments(app_handle: &AppHandle, source: &Path, attachment_id: &str) -> Result<PathBuf>`
    - `pub fn compress_image(path: &Path, max_dimension: u32, quality: u8) -> Result<Vec<u8>>`
    - `pub fn encode_to_base64(data: &[u8], mime_type: &str) -> String` — returns `data:{mime};base64,{data}`
    - `pub async fn delete_attachment(path: &Path) -> Result<()>`
    - `pub fn validate_file(path: &Path, max_size: u64) -> Result<()>`
    - `pub fn detect_mime_type(path: &Path) -> String`
  - **REFACTOR**: Extract constants, clean up error handling
  - Use `image` crate for compression (DynamicImage::resize, save as JPEG)
  - Use `base64::engine::general_purpose::STANDARD` for encoding
  - Use `mime_guess::from_path` for MIME detection

  **Must NOT do**:
  - No database operations (that's Task 9)
  - No Tauri command exposure (that's Task 9)
  - No PDF handling (that's Task 8)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8, 9, 10, 11)
  - **Blocks**: Tasks 9, 10, 18
  - **Blocked By**: Tasks 1, 2, 3, 5

  **References**:
  - `src-tauri/src/services/chat_service.rs` — existing service pattern (pub async fn, AppError returns)
  - `src-tauri/src/error.rs` — AppError enum to extend with file-related variants
  - `src-tauri/src/state.rs` — AppState for accessing app_handle/paths
  - `image` crate docs: resize, save_with_format, DynamicImage
  - `base64` crate docs: Engine::encode
  - `mime_guess` crate docs: from_path

  **Acceptance Criteria**:
  - [ ] All 7+ tests pass: `cargo test file_service`
  - [ ] Image compression: 4000x3000 image → output ≤ 1920px max dimension
  - [ ] Base64 output starts with `data:image/jpeg;base64,`
  - [ ] File validation rejects 11MB file with appropriate error
  - [ ] Delete removes file from disk (verified with fs::metadata)

  **QA Scenarios**:
  ```
  Scenario: Image compression works correctly
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_compress_image -- --nocapture`
      2. Assert output shows: original dimensions > 1920, output dimensions ≤ 1920
      3. Assert output file size < 2MB
    Expected Result: Image resized and compressed within limits
    Evidence: .sisyphus/evidence/task-7-compress-test.txt

  Scenario: File size validation rejects oversized file
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_validate_file_size`
      2. Assert test creates 11MB temp file and validate_file returns Err
    Expected Result: Validation error for oversized file
    Evidence: .sisyphus/evidence/task-7-validation-test.txt
  ```

  **Commit**: YES
  - Message: `feat(service): implement file service — copy, compress, base64, delete`
  - Files: `src-tauri/src/services/file_service.rs`, `src-tauri/src/services/mod.rs`, `src-tauri/src/error.rs`
  - Pre-commit: `cd src-tauri && cargo test file_service`

- [x] 8. Rust PDF/TXT Extraction Service (TDD)

  **What to do**:
  - Create `src-tauri/src/services/extraction_service.rs`
  - **RED**: Write tests first:
    - `test_extract_text_from_txt` — reads UTF-8 text file
    - `test_extract_text_from_pdf` — extracts text from simple PDF
    - `test_extract_empty_pdf` — returns empty string (no panic) for image-only PDF
    - `test_extract_large_file_truncation` — truncates to max 50,000 chars
    - `test_unsupported_format` — returns error for .exe, .zip, etc.
  - **GREEN**: Implement:
    - `pub fn extract_text(path: &Path) -> Result<String>` — dispatcher by extension
    - `fn extract_txt(path: &Path) -> Result<String>` — fs::read_to_string with UTF-8 fallback
    - `fn extract_pdf(path: &Path) -> Result<String>` — pdf_extract::extract_text
    - `fn truncate_text(text: String, max_chars: usize) -> String`
  - **REFACTOR**: Add supported extensions list, clean error messages
  - Graceful fallback: if pdf-extract fails, return `"[Text extraction failed for this PDF]"`

  **Must NOT do**:
  - No OCR (explicitly excluded in guardrails)
  - No DOCX/XLSX support (out of scope — only PDF and TXT)
  - No streaming/chunked extraction

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 9, 10, 11)
  - **Blocks**: Tasks 10, 18
  - **Blocked By**: Tasks 1, 2, 5

  **References**:
  - `pdf-extract` crate docs: `extract_text(&path)`
  - `src-tauri/src/services/file_service.rs` (Task 7) — same service pattern
  - `src-tauri/src/error.rs` — AppError variants

  **Acceptance Criteria**:
  - [ ] All 5 tests pass: `cargo test extraction_service`
  - [ ] TXT extraction returns file content as string
  - [ ] PDF extraction returns text (tested with a simple test PDF)
  - [ ] Empty/image-only PDF returns graceful message, no panic
  - [ ] Text truncated at 50,000 chars for large files

  **QA Scenarios**:
  ```
  Scenario: PDF text extraction works
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_extract_text_from_pdf -- --nocapture`
      2. Assert output contains extracted text from test PDF fixture
    Expected Result: Text successfully extracted from PDF
    Evidence: .sisyphus/evidence/task-8-pdf-extract.txt

  Scenario: Graceful failure on corrupt PDF
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_extract_empty_pdf`
      2. Assert returns Ok with fallback message, NOT Err/panic
    Expected Result: No crash, graceful fallback string returned
    Evidence: .sisyphus/evidence/task-8-graceful-fail.txt
  ```

  **Commit**: YES
  - Message: `feat(service): implement document text extraction`
  - Files: `src-tauri/src/services/extraction_service.rs`, `src-tauri/src/services/mod.rs`, test fixtures
  - Pre-commit: `cd src-tauri && cargo test extraction_service`

- [x] 9. Rust File Commands — Tauri IPC Layer (TDD)

  **What to do**:
  - Create `src-tauri/src/commands/file.rs`
  - **RED**: Write integration tests for each command
  - **GREEN**: Implement Tauri commands:
    - `#[tauri::command] pub async fn attach_files(app: AppHandle, state: State<AppState>, file_paths: Vec<String>) -> Result<Vec<Attachment>>`
      - Validates count (≤5), size (≤10MB each), copies to app_data, detects MIME, compresses images, extracts text from docs, inserts DB records, returns Attachment structs
    - `#[tauri::command] pub async fn remove_attachment(state: State<AppState>, attachment_id: String) -> Result<()>`
      - Deletes file from disk + DB record
    - `#[tauri::command] pub async fn get_attachments_for_message(state: State<AppState>, message_id: String) -> Result<Vec<Attachment>>`
      - Queries DB for message's attachments
    - `#[tauri::command] pub async fn get_attachment_base64(state: State<AppState>, attachment_id: String) -> Result<String>`
      - Reads file, compresses if image, returns base64 data URI
  - Register commands in `src-tauri/src/lib.rs` invoke_handler
  - Register in `src-tauri/src/commands/mod.rs`

  **Must NOT do**:
  - No frontend integration (that's Task 12/15)
  - No multimodal message construction (that's Task 10)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 7)
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 10, 11)
  - **Blocks**: Tasks 12, 15, 18
  - **Blocked By**: Tasks 2, 3, 4, 7

  **References**:
  - `src-tauri/src/commands/chat.rs` — existing command pattern (async, State<AppState>, Result<T, AppError>)
  - `src-tauri/src/services/file_service.rs` (Task 7) — service to call
  - `src-tauri/src/services/extraction_service.rs` (Task 8) — for text extraction
  - `src-tauri/src/lib.rs` — invoke_handler registration pattern
  - `src-tauri/src/models/attachment.rs` (Task 3) — return type

  **Acceptance Criteria**:
  - [ ] All commands registered in invoke_handler
  - [ ] `cargo test commands_file` passes
  - [ ] attach_files: copies file, creates DB record, returns Attachment with correct fields
  - [ ] remove_attachment: deletes file + DB record
  - [ ] get_attachment_base64: returns valid data URI string

  **QA Scenarios**:
  ```
  Scenario: attach_files command works end-to-end
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_attach_files_command`
      2. Assert: file copied to app_data, DB record created, returned Attachment has all fields
    Expected Result: Full attach flow works via command
    Evidence: .sisyphus/evidence/task-9-attach-command.txt

  Scenario: Validation rejects too many files
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_attach_files_exceeds_limit`
      2. Assert: passing 6 file paths returns Err with validation message
    Expected Result: Error returned for >5 files
    Evidence: .sisyphus/evidence/task-9-validation-reject.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): add file Tauri commands`
  - Files: `src-tauri/src/commands/file.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 10. Rust Chat Service — Multimodal Message Construction (TDD)

  **What to do**:
  - Modify `src-tauri/src/services/chat_service.rs`
  - **RED**: Write tests:
    - `test_build_openai_multimodal_message` — text + image → content array with text + image_url parts
    - `test_build_anthropic_multimodal_message` — text + image → content array with text + image blocks
    - `test_build_message_with_document` — text + PDF → text content with XML file block injected
    - `test_build_message_text_only` — no attachments → same as current behavior
    - `test_build_message_mixed` — images + documents → correct combination
  - **GREEN**: Implement:
    - Modify `send_openai_compatible()` to check for attachments on user messages
    - If attachments exist: build content as array `[{type:"text",...}, {type:"image_url",...}, ...]`
    - For documents: prepend extracted text as XML block in the text content part
    - Modify `send_anthropic()` similarly with Anthropic's format: `{type:"image", source:{type:"base64", media_type, data}}`
    - Add helper: `fn build_multimodal_content(content: &str, attachments: &[Attachment]) -> serde_json::Value`
  - **REFACTOR**: Extract format-specific builders

  **Must NOT do**:
  - No frontend changes
  - No new Tauri commands
  - No model capability checking (always send, let API error)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Tasks 7, 8)
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 11)
  - **Blocks**: Task 18
  - **Blocked By**: Tasks 1, 2, 3, 5, 7, 8

  **References**:
  - `src-tauri/src/services/chat_service.rs:377` — `send_openai_compatible()` current implementation
  - `src-tauri/src/services/chat_service.rs:460` — `send_anthropic()` current implementation
  - LobeHub exploration: OpenAI format = `{type:"image_url", image_url:{url:"data:...", detail:"auto"}}`
  - LobeHub exploration: Anthropic format = `{type:"image", source:{type:"base64", media_type:"image/png", data:"..."}}`
  - LobeHub exploration: Documents = XML `<files_info><file name="..." type="...">content</file></files_info>`

  **Acceptance Criteria**:
  - [ ] All 5 tests pass: `cargo test multimodal`
  - [ ] OpenAI format: content is array with text + image_url parts
  - [ ] Anthropic format: content is array with text + image blocks
  - [ ] Document text injected as XML in text content
  - [ ] Text-only messages unchanged (backward compatible)

  **QA Scenarios**:
  ```
  Scenario: OpenAI multimodal payload correct
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_build_openai_multimodal_message -- --nocapture`
      2. Assert JSON output contains: content array, type "image_url", url starts with "data:image"
    Expected Result: Valid OpenAI multimodal content array
    Evidence: .sisyphus/evidence/task-10-openai-multimodal.txt

  Scenario: Anthropic multimodal payload correct
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_build_anthropic_multimodal_message -- --nocapture`
      2. Assert JSON output contains: type "image", source.type "base64", source.media_type
    Expected Result: Valid Anthropic multimodal content block
    Evidence: .sisyphus/evidence/task-10-anthropic-multimodal.txt
  ```

  **Commit**: YES
  - Message: `feat(chat): add multimodal message construction`
  - Files: `src-tauri/src/services/chat_service.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 11. Rust Cleanup Service — Orphan Detection, Cascade Delete (TDD)

  **What to do**:
  - Create `src-tauri/src/services/cleanup_service.rs`
  - **RED**: Write tests:
    - `test_delete_message_attachments` — deletes all files for a message
    - `test_delete_session_attachments` — deletes all files for all messages in session
    - `test_cleanup_orphaned_files` — finds files on disk without DB records, deletes them
    - `test_get_storage_usage` — returns total bytes used by attachments
  - **GREEN**: Implement:
    - `pub async fn delete_message_attachments(pool: &SqlitePool, message_id: &str) -> Result<()>`
    - `pub async fn delete_session_attachments(pool: &SqlitePool, session_id: &str) -> Result<()>`
    - `pub async fn cleanup_orphaned_files(pool: &SqlitePool, attachments_dir: &Path) -> Result<u64>` (returns bytes freed)
    - `pub async fn get_storage_usage(attachments_dir: &Path) -> Result<u64>`
  - Note: CASCADE on messages table handles DB cleanup automatically; this service handles FILE cleanup

  **Must NOT do**:
  - No scheduled/automatic cleanup (manual trigger only for now)
  - No storage quota enforcement

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Task 20
  - **Blocked By**: Tasks 1, 3, 5, 7

  **References**:
  - `src-tauri/src/services/chat_service.rs` — existing service pattern
  - `src-tauri/migrations/20260520000_attachments.sql` — ON DELETE CASCADE
  - `src-tauri/src/services/file_service.rs` (Task 7) — delete_attachment function

  **Acceptance Criteria**:
  - [ ] All 4 tests pass: `cargo test cleanup_service`
  - [ ] Message deletion triggers file cleanup
  - [ ] Orphan detection finds files without DB records
  - [ ] Storage usage returns correct byte count

  **QA Scenarios**:
  ```
  Scenario: Session delete cleans up all files
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_delete_session_attachments`
      2. Assert: files created, session deleted, files no longer on disk
    Expected Result: All attachment files removed when session deleted
    Evidence: .sisyphus/evidence/task-11-session-cleanup.txt
  ```

  **Commit**: YES
  - Message: `feat(service): implement file cleanup service`
  - Files: `src-tauri/src/services/cleanup_service.rs`, `src-tauri/src/services/mod.rs`
  - Pre-commit: `cd src-tauri && cargo test cleanup_service`

- [x] 12. Zustand File Store — useFileStore (TDD)

  **What to do**:
  - Create `src/stores/useFileStore.ts`
  - **RED**: Write tests in `src/stores/useFileStore.test.ts`:
    - `test_initial_state_empty` — pendingFiles is empty array
    - `test_add_file` — adds AttachmentItem to pendingFiles
    - `test_remove_file` — removes by id
    - `test_clear_files` — empties pendingFiles
    - `test_update_file_status` — updates status field
    - `test_max_files_enforcement` — addFile rejects when at 5
    - `test_clear_after_send` — clearFiles resets state
  - **GREEN**: Implement store:
    ```typescript
    interface FileStoreState {
      pendingFiles: AttachmentItem[];
      addFile: (file: AttachmentItem) => void;
      addFiles: (files: AttachmentItem[]) => void;
      removeFile: (id: string) => void;
      updateFileStatus: (id: string, status: AttachmentStatus, error?: string) => void;
      clearFiles: () => void;
      isProcessing: () => boolean;
    }
    ```
  - Store is independent — no Tauri invoke calls (those happen in the component layer)

  **Must NOT do**:
  - No Tauri invoke calls in the store (keep it pure state)
  - No persistence (files are transient until sent)
  - No file reading/processing logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 13-17)
  - **Blocks**: Tasks 13, 14, 15, 18
  - **Blocked By**: Tasks 1, 2, 6, 9

  **References**:
  - `src/stores/useChatStore.ts` — existing zustand store pattern (create from zustand)
  - `src/types/index.ts` — AttachmentItem, AttachmentStatus types (Task 2)
  - `src/lib/constants.ts` — FileAttachmentConfig.MAX_FILES (Task 2)

  **Acceptance Criteria**:
  - [ ] Store exports `useFileStore` hook
  - [ ] All 7 tests pass: `bunx vitest run src/stores/useFileStore.test.ts`
  - [ ] addFile rejects at MAX_FILES with no state change
  - [ ] State is reactive (zustand subscription works)

  **QA Scenarios**:
  ```
  Scenario: Store state management works
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/stores/useFileStore.test.ts`
      2. Assert exit code 0
      3. Assert output shows 7 tests passed
    Expected Result: All store tests pass
    Evidence: .sisyphus/evidence/task-12-store-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(store): add useFileStore for attachment state`
  - Files: `src/stores/useFileStore.ts`, `src/stores/useFileStore.test.ts`
  - Pre-commit: `bunx vitest run src/stores/useFileStore.test.ts`

- [x] 13. FileChips Component — Preview Chips Above Input (TDD)

  **What to do**:
  - Create `src/components/chat/FileChips.tsx`
  - **RED**: Write tests in `src/components/chat/FileChips.test.tsx`:
    - `test_renders_nothing_when_empty` — no chips when pendingFiles is []
    - `test_renders_file_chips` — shows chip per file with name + size
    - `test_image_chip_shows_thumbnail` — img tag with previewUrl
    - `test_doc_chip_shows_icon` — file icon for non-image
    - `test_remove_button_calls_removeFile` — click X removes from store
    - `test_shows_processing_spinner` — spinner when status is 'processing'
    - `test_shows_error_state` — red border + error icon when status is 'error'
  - **GREEN**: Implement component:
    - Horizontal scrollable row of chips (flex, overflow-x-auto)
    - Each chip: 160x56px, rounded, shows thumbnail/icon + filename (truncated) + size + X button
    - Image files: show `<img src={previewUrl}>` as thumbnail
    - Doc files: show FileText icon from lucide-react
    - Status indicators: spinner (processing), check (ready), X (error)
    - Reads from `useFileStore.pendingFiles`
  - Style with Tailwind, match existing dark theme

  **Must NOT do**:
  - No drag-to-reorder
  - No file editing/cropping
  - No click-to-preview (that's Task 17 for message history)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 14-17)
  - **Blocks**: Tasks 15, 18
  - **Blocked By**: Tasks 2, 6, 12

  **References**:
  - `src/components/chat/ChatInputBar.tsx` — where FileChips will be rendered (above textarea)
  - `src/stores/useFileStore.ts` (Task 12) — store to read from
  - `src/index.css` — design system CSS variables (colors, radii, spacing)
  - LobeHub reference: `src/features/ChatInput/Desktop/FilePreview/FileItem/index.tsx` — 180x64px chip pattern

  **Acceptance Criteria**:
  - [ ] All 7 tests pass: `bunx vitest run src/components/chat/FileChips.test.tsx`
  - [ ] Component renders chips for each pending file
  - [ ] Image chips show thumbnail preview
  - [ ] Remove button removes file from store
  - [ ] Matches dark theme styling

  **QA Scenarios**:
  ```
  Scenario: FileChips renders correctly
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/components/chat/FileChips.test.tsx`
      2. Assert all tests pass
    Expected Result: Component renders and interacts correctly
    Evidence: .sisyphus/evidence/task-13-filechips-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add FileChips component`
  - Files: `src/components/chat/FileChips.tsx`, `src/components/chat/FileChips.test.tsx`
  - Pre-commit: `bunx vitest run src/components/chat/FileChips.test.tsx`

- [x] 14. DragDropZone Component — Overlay + Drop Handler (TDD)

  **What to do**:
  - Create `src/components/chat/DragDropZone.tsx`
  - **RED**: Write tests:
    - `test_no_overlay_by_default` — overlay hidden when not dragging
    - `test_shows_overlay_on_dragover` — overlay visible during drag
    - `test_hides_overlay_on_dragleave` — overlay hides when drag leaves
    - `test_calls_onDrop_with_files` — drop event triggers callback with File[]
    - `test_renders_children` — wraps children transparently
  - **GREEN**: Implement:
    - Wrapper component with `onDragOver`, `onDragLeave`, `onDrop` handlers
    - Overlay: semi-transparent dark backdrop with "Drop files here" text + upload icon
    - `onDrop`: extract files from `e.dataTransfer.files`, call `onFilesDropped(files)` prop
    - Prevent default on dragover to enable drop
  - Style: overlay with `bg-black/60`, centered text, border-dashed highlight

  **Must NOT do**:
  - No file processing in this component (just passes File[] to callback)
  - No validation here (validation happens in the handler)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 13, 15-17)
  - **Blocks**: Task 18
  - **Blocked By**: Tasks 4, 6, 12

  **References**:
  - `src/components/chat/ChatPanel.tsx` — where DragDropZone will wrap the chat area
  - LobeHub reference: `src/components/DragUploadZone/index.tsx` — overlay pattern
  - `src/index.css` — design tokens for colors

  **Acceptance Criteria**:
  - [ ] All 5 tests pass
  - [ ] Overlay appears on drag, disappears on leave/drop
  - [ ] Files extracted from drop event correctly
  - [ ] Children render normally when not dragging

  **QA Scenarios**:
  ```
  Scenario: DragDropZone tests pass
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/components/chat/DragDropZone.test.tsx`
      2. Assert all tests pass
    Expected Result: Drag/drop behavior works correctly
    Evidence: .sisyphus/evidence/task-14-dragdrop-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add DragDropZone component`
  - Files: `src/components/chat/DragDropZone.tsx`, `src/components/chat/DragDropZone.test.tsx`
  - Pre-commit: `bunx vitest run src/components/chat/DragDropZone.test.tsx`

- [x] 15. ChatInputBar Integration — Paperclip + Paste (TDD)

  **What to do**:
  - Modify `src/components/chat/ChatInputBar.tsx`
  - **RED**: Write tests:
    - `test_paperclip_opens_file_dialog` — click paperclip triggers Tauri dialog
    - `test_paste_image_adds_to_store` — Ctrl+V with image adds to pendingFiles
    - `test_paste_text_only_no_file` — Ctrl+V with text doesn't trigger file attach
    - `test_send_includes_attachments` — onSend called with files from store
    - `test_files_cleared_after_send` — pendingFiles empty after send
    - `test_filechips_rendered_above_input` — FileChips component visible when files pending
  - **GREEN**: Implement:
    - Connect Paperclip button onClick → `open()` from `@tauri-apps/plugin-dialog` (multiple: true, filters for images + docs)
    - On file selection → invoke `attach_files` command → add results to useFileStore
    - Add `onPaste` handler to textarea: check `clipboardData.items` for image types, convert to File, invoke attach
    - Render `<FileChips />` above textarea when `pendingFiles.length > 0`
    - Modify handleSend: read pendingFiles, pass attachment IDs to onSend, then clearFiles
  - Update `onSend` prop type: `(content: string, attachmentIds?: string[]) => void`

  **Must NOT do**:
  - No drag & drop here (that's DragDropZone wrapping ChatPanel)
  - No file processing logic (Rust handles it)
  - No inline image preview in textarea

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-14, 16-17)
  - **Blocks**: Task 18
  - **Blocked By**: Tasks 4, 6, 12, 13

  **References**:
  - `src/components/chat/ChatInputBar.tsx:179-190` — existing dead Paperclip button
  - `src/components/chat/FileChips.tsx` (Task 13) — component to render
  - `src/stores/useFileStore.ts` (Task 12) — store to interact with
  - `@tauri-apps/plugin-dialog` docs — `open()` function with filters
  - `src/components/layout/AppShell.tsx:460` — handleSend to update signature

  **Acceptance Criteria**:
  - [ ] All 6 tests pass
  - [ ] Paperclip button opens native file dialog
  - [ ] Selected files appear as chips above input
  - [ ] Paste image from clipboard adds to pending files
  - [ ] Send includes attachment IDs, clears file state after

  **QA Scenarios**:
  ```
  Scenario: ChatInputBar integration tests pass
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/components/chat/ChatInputBar.test.tsx`
      2. Assert all tests pass
    Expected Result: File attach integration works
    Evidence: .sisyphus/evidence/task-15-inputbar-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): integrate file attach in ChatInputBar`
  - Files: `src/components/chat/ChatInputBar.tsx`, `src/components/chat/ChatInputBar.test.tsx`
  - Pre-commit: `bunx vitest run`

- [x] 16. ChatMessage Attachment Rendering — Images + Docs (TDD)

  **What to do**:
  - Modify `src/components/chat/ChatMessage.tsx`
  - **RED**: Write tests:
    - `test_message_without_attachments_unchanged` — existing behavior preserved
    - `test_message_with_image_shows_thumbnail` — img element rendered
    - `test_message_with_document_shows_card` — file card with icon + name + size
    - `test_multiple_attachments_grid` — images in grid layout
    - `test_image_click_opens_lightbox` — click triggers lightbox (Task 17)
  - **GREEN**: Implement:
    - After message text, render attachments section if `message.attachments?.length > 0`
    - Images: grid of thumbnails (max 3 per row), loaded via Tauri asset protocol or base64
    - Documents: card with FileText icon, filename, file size, "Text extracted" badge
    - Use `convertFileSrc()` from `@tauri-apps/api` to convert local paths to asset URLs
  - Style: image grid with rounded corners, document cards with subtle border

  **Must NOT do**:
  - No inline image in markdown (separate attachment section)
  - No file download button (files are local)
  - No document content preview (just metadata card)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-15, 17)
  - **Blocks**: Task 18
  - **Blocked By**: Tasks 2, 6

  **References**:
  - `src/components/chat/ChatMessage.tsx` — existing message renderer to extend
  - `src/types/index.ts` — Message.attachments field (Task 2)
  - `@tauri-apps/api` docs — `convertFileSrc()` for asset protocol URLs
  - `src-tauri/tauri.conf.json:23-25` — asset protocol already enabled

  **Acceptance Criteria**:
  - [ ] All 5 tests pass
  - [ ] Images render as thumbnails in grid
  - [ ] Documents render as info cards
  - [ ] Existing messages without attachments unchanged
  - [ ] Asset protocol URLs work for local file display

  **QA Scenarios**:
  ```
  Scenario: Message rendering tests pass
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/components/chat/ChatMessage.test.tsx`
      2. Assert all tests pass
    Expected Result: Attachment rendering works correctly
    Evidence: .sisyphus/evidence/task-16-message-render-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): render attachments in ChatMessage`
  - Files: `src/components/chat/ChatMessage.tsx`, `src/components/chat/ChatMessage.test.tsx`
  - Pre-commit: `bunx vitest run`

- [x] 17. Image Lightbox/Zoom Component (TDD)

  **What to do**:
  - Create `src/components/chat/ImageLightbox.tsx`
  - **RED**: Write tests:
    - `test_not_visible_by_default` — nothing rendered when closed
    - `test_opens_with_image` — shows full-size image when triggered
    - `test_close_on_backdrop_click` — clicking outside closes
    - `test_close_on_escape` — Escape key closes
    - `test_shows_filename` — displays filename below image
  - **GREEN**: Implement:
    - Modal overlay (fixed, z-50, bg-black/80)
    - Full-size image centered (max-w/max-h with object-contain)
    - Close button (X) top-right
    - Filename + size below image
    - Keyboard: Escape to close
    - Controlled via props: `{ isOpen, imageSrc, fileName, onClose }`
  - Simple implementation — no zoom/pan (keep it minimal)

  **Must NOT do**:
  - No zoom/pan gestures
  - No image gallery/carousel (single image view)
  - No download button

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-16)
  - **Blocks**: Task 18
  - **Blocked By**: Task 6

  **References**:
  - `src/index.css` — design tokens
  - Existing modal patterns in codebase (if any)

  **Acceptance Criteria**:
  - [ ] All 5 tests pass
  - [ ] Lightbox opens with full-size image
  - [ ] Closes on backdrop click and Escape
  - [ ] Accessible (focus trap, aria labels)

  **QA Scenarios**:
  ```
  Scenario: Lightbox tests pass
    Tool: Bash
    Steps:
      1. Run `bunx vitest run src/components/chat/ImageLightbox.test.tsx`
      2. Assert all tests pass
    Expected Result: Lightbox behavior correct
    Evidence: .sisyphus/evidence/task-17-lightbox-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add image lightbox component`
  - Files: `src/components/chat/ImageLightbox.tsx`, `src/components/chat/ImageLightbox.test.tsx`
  - Pre-commit: `bunx vitest run`

- [x] 18. End-to-End Integration — Full Flow Wiring

  **What to do**:
  - Wire all components together for the complete flow:
  - **AppShell.tsx** modifications:
    - Update `handleSend` to accept `attachmentIds?: string[]`
    - Pass attachment IDs to `invoke('send_message', { ..., attachmentIds })`
    - After send, fetch message with attachments for display
  - **send_message command** (Rust):
    - Accept optional `attachment_ids: Vec<String>` parameter
    - After saving message to DB, update attachments' `message_id` to link them
    - When building LLM payload, fetch attachments and include in multimodal content
  - **ChatPanel.tsx**:
    - Wrap with `<DragDropZone>`, connect onFilesDropped to file attach flow
    - Messages now include attachments from DB
  - **get_messages command** (Rust):
    - JOIN with attachments table, return messages with their attachments populated
  - Integration test: full flow from attach → send → render in history

  **Must NOT do**:
  - No new components (all built in previous tasks)
  - No new services (all built in previous tasks)
  - Just wiring and integration

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential after Wave 3)
  - **Blocks**: Tasks 19, 20
  - **Blocked By**: Tasks 7-17 (all previous tasks)

  **References**:
  - `src/components/layout/AppShell.tsx:460` — handleSend function
  - `src-tauri/src/commands/chat.rs` — send_message command to modify
  - `src-tauri/src/services/chat_service.rs` — send_message_inner to modify
  - `src/components/chat/ChatPanel.tsx` — message list to wrap with DragDropZone
  - All Task 7-17 outputs

  **Acceptance Criteria**:
  - [ ] Full flow works: attach image → send → image visible in history → LLM receives base64
  - [ ] Full flow works: attach PDF → send → text extracted → sent as context
  - [ ] Drag & drop onto chat area triggers file attach
  - [ ] Messages loaded from DB include their attachments
  - [ ] `cargo test` and `bunx vitest run` both pass

  **QA Scenarios**:
  ```
  Scenario: Full image attach flow
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_full_image_attach_flow`
      2. Assert: file copied, compressed, DB record created, message linked, multimodal payload built correctly
    Expected Result: Complete image flow works end-to-end
    Evidence: .sisyphus/evidence/task-18-e2e-image.txt

  Scenario: Full document attach flow
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_full_document_attach_flow`
      2. Assert: file copied, text extracted, DB record created, XML injected in message content
    Expected Result: Complete document flow works end-to-end
    Evidence: .sisyphus/evidence/task-18-e2e-document.txt
  ```

  **Commit**: YES
  - Message: `feat(integration): wire end-to-end file attachment flow`
  - Files: `src/components/layout/AppShell.tsx`, `src-tauri/src/commands/chat.rs`, `src-tauri/src/services/chat_service.rs`, `src/components/chat/ChatPanel.tsx`
  - Pre-commit: `cargo test && bunx vitest run`

- [x] 19. Error Handling + Edge Cases

  **What to do**:
  - Add comprehensive error handling across the feature:
  - **Frontend**:
    - Toast notifications for: file too large, too many files, unsupported type, processing failed
    - Create `src/components/ui/Toast.tsx` (simple notification component) or use existing pattern
    - Error state in FileChips (red border, error icon, tooltip with message)
    - Graceful handling when Tauri invoke fails (network error, backend crash)
  - **Backend**:
    - Proper AppError variants: `FileTooLarge`, `TooManyFiles`, `UnsupportedFileType`, `ExtractionFailed`, `FileNotFound`
    - Validate MIME types against allowlist (images: png, jpg, gif, webp, bmp; docs: pdf, txt, md)
    - Handle corrupt files (image that can't be decoded, PDF that can't be parsed)
    - Partial failure: if 3/5 files succeed and 2 fail, keep the 3 and report errors for 2
  - Write tests for each error scenario

  **Must NOT do**:
  - No retry logic (user can re-attach manually)
  - No error reporting/telemetry

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 18)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 18

  **References**:
  - `src-tauri/src/error.rs` — existing AppError enum to extend
  - `src/lib/constants.ts` — FileAttachmentConfig (allowed types, limits)
  - All service files from Wave 2

  **Acceptance Criteria**:
  - [ ] All error scenarios have tests (Rust + frontend)
  - [ ] 11MB file → clear error message to user
  - [ ] 6th file → clear error message
  - [ ] Corrupt image → error state on chip, other files unaffected
  - [ ] Corrupt PDF → graceful fallback text, no crash
  - [ ] `cargo test` and `bunx vitest run` pass

  **QA Scenarios**:
  ```
  Scenario: Oversized file rejected gracefully
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_reject_oversized_file`
      2. Assert: returns FileTooLarge error with human-readable message
    Expected Result: Clear error, no crash
    Evidence: .sisyphus/evidence/task-19-oversize-error.txt

  Scenario: Partial failure handling
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_partial_file_failure`
      2. Assert: 3 valid files succeed, 2 invalid files return individual errors
    Expected Result: Successful files kept, failed files reported individually
    Evidence: .sisyphus/evidence/task-19-partial-failure.txt
  ```

  **Commit**: YES
  - Message: `feat(error): add comprehensive error handling`
  - Files: `src-tauri/src/error.rs`, `src/components/ui/Toast.tsx`, multiple test files
  - Pre-commit: `cargo test && bunx vitest run`

- [x] 20. Cleanup Service Integration — Delete Cascades

  **What to do**:
  - Wire cleanup service into existing delete flows:
  - **Modify `delete_message` command** (or add hook):
    - After DB cascade deletes attachment records, also delete files from disk
    - Call `cleanup_service::delete_message_attachments()`
  - **Modify `delete_session` command** (or add hook):
    - Before/after session deletion, clean up all attachment files
    - Call `cleanup_service::delete_session_attachments()`
  - **Add startup cleanup**:
    - On app launch, run `cleanup_orphaned_files()` to catch any files left from crashes
    - Add to `src-tauri/src/lib.rs` setup hook
  - Write integration tests verifying cascade behavior

  **Must NOT do**:
  - No background scheduled cleanup
  - No storage quota UI
  - No "empty trash" feature

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 18)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 11, 18

  **References**:
  - `src-tauri/src/services/cleanup_service.rs` (Task 11) — service to call
  - `src-tauri/src/commands/session.rs` — existing delete_session command
  - `src-tauri/src/commands/chat.rs` — existing message operations
  - `src-tauri/src/lib.rs` — app setup hook for startup cleanup

  **Acceptance Criteria**:
  - [ ] Delete message → attachment files removed from disk
  - [ ] Delete session → all session attachment files removed
  - [ ] App startup → orphaned files cleaned
  - [ ] Integration tests pass

  **QA Scenarios**:
  ```
  Scenario: Message delete cascades to files
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_message_delete_cleans_files`
      2. Assert: create message + attachment file, delete message, verify file gone from disk
    Expected Result: Files cleaned on message delete
    Evidence: .sisyphus/evidence/task-20-cascade-delete.txt

  Scenario: Startup cleanup runs
    Tool: Bash
    Steps:
      1. Run `cd src-tauri && cargo test test_startup_orphan_cleanup`
      2. Assert: orphaned file (no DB record) is deleted on cleanup run
    Expected Result: Orphaned files removed
    Evidence: .sisyphus/evidence/task-20-startup-cleanup.txt
  ```

  **Commit**: YES
  - Message: `feat(cleanup): integrate cascade delete on message/session removal`
  - Files: `src-tauri/src/commands/chat.rs`, `src-tauri/src/commands/session.rs`, `src-tauri/src/lib.rs`
  - Pre-commit: `cd src-tauri && cargo test`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo clippy -- -D warnings` + `bunx vitest run`. Review all changed files for: `unwrap()` in production paths, `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Clippy [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (attach + send + render + delete). Test edge cases: empty file, corrupt PDF, 11MB file, 6 files, paste text-only. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files |
|------|---------------|-------|
| 1 | `build(test): setup vitest + cargo test infrastructure` | vitest.config.ts, package.json, src-tauri/tests/ |
| 1 | `feat(types): add attachment type definitions` | src/types/index.ts, src-tauri/src/models/attachment.rs |
| 1 | `feat(db): add attachments table migration` | src-tauri/migrations/YYYYMMDD_attachments.sql |
| 1 | `build(tauri): grant fs permissions in capabilities` | src-tauri/capabilities/default.json |
| 1 | `build(deps): add image, pdf-extract, base64, mime_guess crates` | src-tauri/Cargo.toml |
| 2 | `feat(service): implement file service — copy, compress, base64, delete` | src-tauri/src/services/file_service.rs |
| 2 | `feat(service): implement document text extraction` | src-tauri/src/services/extraction_service.rs |
| 2 | `feat(commands): add file Tauri commands` | src-tauri/src/commands/file.rs |
| 2 | `feat(chat): add multimodal message construction` | src-tauri/src/services/chat_service.rs |
| 2 | `feat(service): implement file cleanup service` | src-tauri/src/services/cleanup_service.rs |
| 3 | `feat(store): add useFileStore for attachment state` | src/stores/useFileStore.ts |
| 3 | `feat(ui): add FileChips component` | src/components/chat/FileChips.tsx |
| 3 | `feat(ui): add DragDropZone component` | src/components/chat/DragDropZone.tsx |
| 3 | `feat(ui): integrate file attach in ChatInputBar` | src/components/chat/ChatInputBar.tsx |
| 3 | `feat(ui): render attachments in ChatMessage` | src/components/chat/ChatMessage.tsx |
| 3 | `feat(ui): add image lightbox component` | src/components/chat/ImageLightbox.tsx |
| 4 | `feat(integration): wire end-to-end file attachment flow` | multiple files |
| 4 | `feat(error): add comprehensive error handling` | multiple files |
| 4 | `feat(cleanup): integrate cascade delete on message/session removal` | multiple files |

---

## Success Criteria

### Verification Commands
```bash
cargo test                    # Expected: all tests pass
cargo clippy -- -D warnings   # Expected: no warnings
bunx vitest run               # Expected: all tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All Rust tests pass
- [ ] All frontend tests pass
- [ ] Clippy clean
- [ ] Image attach → send → visible in history → LLM receives base64
- [ ] PDF attach → text extracted → sent as context
- [ ] Delete message → files cleaned from disk
- [ ] 5+ files rejected
- [ ] 10MB+ file rejected
