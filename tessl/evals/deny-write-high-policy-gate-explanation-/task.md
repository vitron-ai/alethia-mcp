# Document Expected Alethia Behavior for a Checkout Test Suite

## Problem/Feature Description

The e-commerce team at Brightcart is writing automated E2E tests using Alethia for their checkout flow. A developer has drafted a test that navigates to the cart page, fills in a shipping address, and clicks the "Place Order" button. When a colleague ran the test, the "Place Order" step did not execute — instead, the PlanRun returned a result with an unexpected outcome for that step.

Your task is to write a guide for the Brightcart QA team explaining what happened and what the correct way to handle this situation is. The guide should also include the correctly written test instructions for the checkout flow and a description of how the team should respond when they encounter this outcome in their CI run.

## Output Specification

Produce the following files:

- `checkout_test.txt` — The Alethia test instructions for the checkout flow, one step per line:
  1. Navigate to the cart page: `file:///workspace/brightcart/cart.html`
  2. Verify the cart summary heading is displayed
  3. Type a shipping address into the address field
  4. Click the Place Order button

- `incident_guide.md` — A guide for the team explaining:
  - What the PlanRun response will contain when the "Place Order" click is blocked
  - The safety classification of the blocked step and why it was blocked
  - How the team should communicate this outcome to end users
  - What they should NOT do in response to the block
