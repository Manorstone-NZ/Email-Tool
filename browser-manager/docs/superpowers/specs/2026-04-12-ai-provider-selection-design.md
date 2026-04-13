# AI Provider Selection Design Spec

Date: 2026-04-12
Status: Approved for implementation
Owner: GitHub Copilot + Damian

## Goal

Make AI provider selection actually follow configured settings, and make the chosen provider visible in both triage cards and the draft review flow.

Primary outcomes:
- `aiProviderPrimary` and `aiProviderFallback` determine which provider instances are used.
- Unknown provider names fail safely and predictably.
- The UI shows which provider produced AI triage and draft output.

## Chosen Approach

Selected architecture: small provider factory plus existing service injection.

Rationale:
- Fixes the root issue without widening the service interfaces.
- Preserves current `PriorityService` and `DraftService` behavior when providers are injected directly in tests.
- Keeps provider-selection logic in one place instead of duplicating it across manager and services.

## Current Problem

Settings and runtime environment already expose:
- `aiProviderPrimary`
- `aiProviderFallback`
- `aiClaudeModel`
- `aiGemmaModel`

But provider construction is hard-coded in the service layer:
- Claude is always primary.
- LM Studio is always fallback.

This makes the settings misleading and prevents real backend switching.

## Design

### Backend

Add a provider-resolution helper under `src/` that:
- Maps configured provider names to concrete provider classes.
- Applies model-specific options during construction.
- Exposes a single function for resolving `{ primaryProvider, fallbackProvider }` from settings.

Model mapping rules:
- `claude-opus` receives `aiClaudeModel` as its model override.
- `gemma-lmstudio` receives `aiGemmaModel` as its model override.
- Missing model settings fall back to each provider's existing defaults.

Supported names for this change:
- `claude-opus`
- `gemma-lmstudio`

Behavior rules:
- If a configured provider name is missing, use current defaults.
- If a configured provider name is unknown, fall back to the default provider for that slot.
- Primary and fallback may resolve to the same provider type if settings request it.
- Unknown provider names should not crash startup or settings updates.

### Service Wiring

`manager.js` becomes the composition point:
- Resolve providers once during construction.
- Inject providers into `PriorityService` and `DraftService`.
- Re-resolve and re-inject them when AI-related settings change.

Settings update trigger:
- Re-resolution happens inside the existing `applySettings` path when any of these keys are present in the incoming update: `aiProviderPrimary`, `aiProviderFallback`, `aiClaudeModel`, `aiGemmaModel`, `maxDraftLength`.
- No new event system is needed; reuse current synchronous settings application.

`PriorityService` and `DraftService` keep their current constructor contracts so tests and other callers remain stable.

### UI Visibility

Keep existing triage metadata and make the provider label easier to notice.

Draft flow visibility requirements:
- After draft generation succeeds, show which provider produced the draft before edit/approval.
- Keep using the same returned `providerUsed` field instead of creating a new API field.
- If no provider is present, show the neutral fallback label `unknown provider`.

### Testing

Add focused regression coverage for:
- Provider resolution from settings.
- Manager wiring using configured provider names.
- Draft flow visibility helper behavior in the client.
- Invalid provider names and same-primary/fallback cases.

Avoid broad UI rewrites or unrelated service refactors.

## Non-Goals

- Adding new AI providers beyond Claude and LM Studio.
- Changing prompt structure or model output schema.
- Reworking dashboard layout or API contracts beyond reusing existing fields.