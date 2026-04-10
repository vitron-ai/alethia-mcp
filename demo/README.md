# Alethia Demo Pages

Ready-to-use local HTML pages for testing Alethia. Open any page in your browser or drive it with `alethia_tell`.

## Pages

| Page | What it tests | Key features shown |
|---|---|---|
| `signup-form.html` | Login flow with validation | Navigate, type, click, assert, error detection, DOM diffs |
| `todo-app.html` | Dynamic list add/delete | Type, click, assert, list awareness in snapshots |
| `ecommerce.html` | Add to cart → checkout | EA1 policy gate blocks purchase (write-high) |
| `spa-loading.html` | Async data loading (2s delay) | Page readiness detection, MutationObserver wait-for |
| `cookie-banner.html` | Cookie consent + newsletter | Conditional steps ("if banner exists, click Accept") |
| `form-validation.html` | Multi-field validation | Smart assertions, error detection, suggested fixes |

## Prompts

### Login flow (signup-form.html)
```
Use alethia_tell to navigate to file:///PATH/demo/signup-form.html, click Sign In without filling anything in and assert the error message appears, then type admin@acme.com into email, type secret123 into password with allowSensitiveInput true, click Sign In, and assert "Welcome back!" is visible.
```

### Todo list (todo-app.html)
```
Use alethia_tell to navigate to file:///PATH/demo/todo-app.html, type "Ship v1" into the task input, click Add, type "Record demo" into the task input, click Add, type "Send cold DMs" into the task input, click Add, and assert all three items appear in the list.
```

### EA1 policy gate (ecommerce.html)
```
Use alethia_tell to navigate to file:///PATH/demo/ecommerce.html, click "Add to Cart" on the Wireless Keyboard, click "Add to Cart" on the USB-C Hub, assert the cart shows both items, then click "Complete Purchase" and tell me what the policy gate does.
```

### Page readiness / SPA loading (spa-loading.html)
```
Use alethia_tell to navigate to file:///PATH/demo/spa-loading.html and assert "1,247" is visible. The page has a 2-second loading spinner — Alethia should wait for it automatically.
```

### Conditional steps / cookie banner (cookie-banner.html)
```
Use alethia_tell to navigate to file:///PATH/demo/cookie-banner.html. If the cookie banner exists, click Accept. Then type hello@test.com into the email field and click Subscribe. Assert "Subscribed!" is visible.
```

### Form validation / smart assertions (form-validation.html)
```
Use alethia_tell to navigate to file:///PATH/demo/form-validation.html and click Send Message without filling anything. Check what validation errors appear. Then fill in: name "Jane Doe", email "jane@test.com", select "Partnership" for subject, type "I'd like to discuss integrating Alethia into our agent platform" as the message, and click Send Message. Assert "Message Sent!" is visible.
```

## Setup

Replace `PATH` in the prompts above with the actual path to this demo folder:

```bash
# Find your path
npm root -g
# The demos are at: <global_root>/@vitronai/alethia/demo/
```

Or clone the repo and use the local path:
```bash
git clone https://github.com/vitron-ai/alethia-mcp.git
# Demos at: /path/to/alethia-mcp/demo/
```
