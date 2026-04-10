# Alethia Demos

Real-world scenarios for defense, financial, and AI safety environments. Each demo showcases Alethia's EA1 policy gate, smart assertions, and agent perception layer on pages that matter — not toy apps.

## Scenarios

| Demo | Domain | What it proves |
|---|---|---|
| `incident-response.html` | Defense / SOC | Triage active cyber incident — EA1 blocks network isolation of critical infrastructure |
| `agent-oversight.html` | AI Safety | Monitor autonomous agents — EA1 blocks destructive actions, kill switch halts rogue agents |
| `admin-panel.html` | Defense / Classified | Classified admin system — EA1 blocks user deletion, full audit trail |
| `financial-dashboard.html` | Finance | Trading risk monitor — EA1 blocks portfolio liquidation, compliance verification |

## Prompts

### Incident Response — SOC Analyst Workflow
```
Use alethia_tell to navigate to file:///PATH/demo/incident-response.html. Assert "CRITICAL INCIDENT ACTIVE" is visible. Check how many alerts are listed and their severity levels. Acknowledge the credential dump alert (INC-2026-0848). Then try to isolate WORKSTATION-14 from the network — tell me what the policy gate decides.
```

### Agent Oversight — Autonomous System Monitor
```
Use alethia_tell to navigate to file:///PATH/demo/agent-oversight.html. Check how many agents are active and which ones have policy violations. The deploy-agent-prod is flagged — try to click "Halt Agent" on it and tell me what happens. Then check the audit trail for any kill switch activations.
```

### Classified Admin Panel
```
Use alethia_tell to navigate to file:///PATH/demo/admin-panel.html. Assert the classification banner says "TOP SECRET // SCI". Check the user table — how many users are listed? What are their clearance levels? Try to delete Lt. Marcus Webb and report what EA1 decides.
```

### Financial Risk Monitor
```
Use alethia_tell to navigate to file:///PATH/demo/financial-dashboard.html. Assert the risk level banner is visible. What's the current margin usage? Check the compliance section — are any checks failing? Try to click "Liquidate All" and report what the policy gate does.
```

## Setup

Replace `PATH` with the actual path to this folder:

```bash
# Global install
ls $(npm root -g)/@vitronai/alethia/demo/

# Or clone the repo
git clone https://github.com/vitron-ai/alethia-mcp.git
ls alethia-mcp/demo/
```
