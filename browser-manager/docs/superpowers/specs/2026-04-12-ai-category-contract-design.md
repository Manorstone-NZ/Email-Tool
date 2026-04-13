# AI Category Contract Design Spec

Date: 2026-04-12
Status: Approved for implementation
Owner: GitHub Copilot + Damian

## Goal

Make email filter categories come directly from AI output when AI is available, while retaining a heuristic fallback only when AI output is unavailable or invalid.

Primary outcomes:
- The classifier returns `priority`, `category`, `reason`, `draftTone`, and `confidence`.
- `category` is required and must be one of `Needs Reply`, `Waiting on Others`, or `FYI`.
- Each item carries `categorySource` so the UI can distinguish AI-derived categories from heuristic fallback.

## Chosen Approach

Selected architecture: extend the existing priority classifier contract and propagate the result through triage into the existing frontend mapping layer.

Rationale:
- Keeps category semantics in one backend decision point.
- Avoids duplicating categorization rules in the client.
- Preserves current fallback behavior only when AI is not trustworthy.

## Contract

Classifier response fields:
- `priority`
- `category`
- `reason`
- `draftTone`
- `confidence`

Valid category values:
- `Needs Reply`
- `Waiting on Others`
- `FYI`

Source field rules:
- `categorySource = 'ai'` when validated classifier output provides a category.
- `categorySource = 'heuristic'` when AI is unavailable or invalid and the frontend fallback derives the category.

## Data Flow

### Backend

`src/priority-service.js`:
- Extend prompts to require `category`.
- Validate `category` alongside `priority`.
- Return `category` in the normalized decision object.

`src/email-triage.js`:
- Persist `item.primaryCategory` from validated AI output.
- Persist `item.categorySource = 'ai'` when AI output is used.
- Preserve current nulling behavior when AI is unavailable.

### Frontend

`public/email-helpers.js`:
- Trust `item.primaryCategory` when it is valid.
- Emit `categorySource = 'ai'` in mapped items when a valid AI category is present.
- Use current heuristic derivation only when AI category is missing or invalid.
- Emit `categorySource = 'heuristic'` when fallback is used.

## Testing

Required test-first coverage:
- Classifier validation for required valid category values.
- Triage propagation of `primaryCategory` and `categorySource` from AI.
- Frontend selection of AI category and heuristic fallback behavior.

## Non-Goals

- Adding new category values.
- Redesigning the category UI.
- Running a separate AI categorization pass outside the existing classifier.