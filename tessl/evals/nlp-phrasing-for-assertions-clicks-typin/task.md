# Write E2E Test Instructions for a Product Dashboard

## Problem/Feature Description

Meridian Analytics has a web dashboard at `file:///workspace/meridian/dashboard.html`. The page has the following elements:

- A heading that reads "Analytics Overview"
- A "Generate Report" button
- A date range input field labeled "date range"
- A "Download CSV" button
- A confirmation message that reads "Report Ready"

The QA lead wants a plain-English Alethia test instruction script that exercises the full user flow: verifying the heading is visible, entering a date range, generating the report, and asserting the confirmation message appears. She has seen test failures in the past caused by subtle phrasing mistakes in the instruction strings that caused the wrong element to be matched.

Write the Alethia test instructions for this flow, following best practices. The instructions will be pasted directly into the `instructions` parameter of an `alethia_tell` call.

## Output Specification

Produce the following files:

- `instructions.txt` — The plain-English Alethia test instructions, one per line, ready to pass to alethia_tell. Each line is a single test step.
- `notes.md` — A short explanation of any phrasing choices you made and why they were necessary for correct element matching.
