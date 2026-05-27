# Deployment Guide

Comprehensive deployment documentation for Stellar-Spend covering Vercel (primary), AWS with Terraform, blue-green deployments, environment configuration, rollback procedures, and disaster recovery.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Vercel Deployment](#vercel-deployment)
4. [AWS Deployment with Terraform](#aws-deployment-with-terraform)
5. [Blue-Green Deployment Strategy](#blue-green-deployment-strategy)
6. [Pre-Deployment Checklist](#pre-deployment-checklist)
7. [Post-Deployment Verification](#post-deployment-verification)
8. [Rollback Procedures](#rollback-procedures)
9. [Disaster Recovery](#disaster-recovery)

---

## Prerequisites

Before deploying to any environment, ensure you have:

- **Node.js 20+** and **npm** installed
- **Vercel CLI** (`npm i -g vercel`) — for Vercel deployments
- **Terraform ≥ 1.5** and **AWS CLI v2** — for AWS deployments
- **Docker 24+** and **Docker Compose v2** — for container deployments
- A **Paycrest** account with an API key and webhook secret
- A dedicated **Base wallet** (private key + return address) for payout execution
- A **Base RPC** provider URL (Alchemy, QuickNode, or `https://mainnet.base.org`)
- A **Stellar Soroban RPC** endpoint and **Horizon URL**
- (Optional) A **Sentry** project for error monitoring

---

## Environment Configuration

All configuration is driven by environment variables. The app validates all required variables at startup and throws a descriptive error listing every missing variable before accepting requests.

### Required — Server-Only

Must **never** use the `NEXT_PUBLIC_` prefix. Leaking these server-side keys is a security incident.

| Variable | Description |
|----------|-------------|
| `PAYCREST_API_KEY` | Paycrest sender API key |
| `PAYCREST_WEBHOOK_SECRET` | HMAC secret for webhook signature verification |
| `BASE_PRIVATE_KEY` | Private key of the Base wallet signing payout txs (`0x` + 64 hex chars) |
| `BASE_RETURN_ADDRESS` | Public Base address for refunds and treasury routing |
| `BASE_RPC_URL` | Base mainnet RPC endpoint |
| `STELLAR_SOROBAN_RPC_URL` | Soroban RPC endpoint for server-side tx building |
| `STELLAR_HORIZON_URL` | Horizon endpoint (use `https://horizon.stellar.org` for mainnet) |

### Required — Public (Browser-Safe)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL` | Soroban RPC for browser-side calls |
| `NEXT_PUBLIC_BASE_RETURN_ADDRESS` | Base return address exposed to the browser |
| `NEXT_PUBLIC_STELLAR_USDC_ISSUER` | Stellar USDC issuer account (from Circle/Stellar docs) |

### Optional

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry DSN for server-side error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for browser error tracking |
| `SENTRY_ORG` | Sentry org slug (required for source map uploads) |
| `SENTRY_PROJECT` | Sentry project slug (required for source map uploads) |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for CI source map uploads |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins — **always set in production** |
| `API_KEY_ADMIN_TOKEN` | Admin token for the API key management endpoints |
| `ANALYZE` | Set to `true` to generate a bundle analysis report during build |

### Environment-specific configurations

| Variable | Staging | Production |
|----------|---------|------------|
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL` | Testnet endpoint | Mainnet endpoint |
| `ALLOWED_ORIGINS` | `https://staging.your-domain.com` | `https://app.your-domain.com` |
| `SENTRY_DSN` | Staging Sentry project DSN | Production Sentry project DSN |

---

## Vercel Deployment

Vercel is the primary deployment platform. The app is detected as Next.js automatically — no custom build command is required.

### First Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Link the project (creates .vercel/project.json)
vercel link

# Set environment variables in the Vercel dashboard
# Settings → Environment Variables → Add for Production

# Deploy to production
vercel --prod
```

### Automated Deployment via GitHub Actions

The repository's `.github/workflows/deploy.yml` triggers on every push to `main`. The pipeline:
1. Runs lint, type-check, unit tests, and build
2. Runs E2E tests
3. Deploys to Vercel if all checks pass

Required GitHub Actions secrets:

| Secret | Source |
|--------|--------|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens |

### Function duration limits (`vercel.json`)

Long-running API routes have extended timeouts configured:

| Route | Max Duration |
|-------|-------------|
| `api/offramp/quote` | 30 s |
| `api/offramp/execute-payout` | 60 s |
| `api/offramp/bridge/build-tx` | 30 s |
| `api/offramp/bridge/status/*` | 30 s |
| `api/offramp/status/*` | 30 s |

### Preview deployments

Every pull request gets an automatic preview deployment. Use preview URLs to QA changes before merging to `main`.

### Custom domain setup

1. Vercel project → Settings → Domains → Add domain
2. Add the required DNS records at your registrar:

| Type | Name | Value |
|------|------|-------|
| `A` | `@` (apex) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `app` (subdomain) | `cname.vercel-dns.com` |

3. Update `ALLOWED_ORIGINS` to include the new domain.
4. Update the Paycrest webhook URL to `https://your-domain.com/api/webhooks/paycrest`.

---

## AWS Deployment with Terraform

The `terraform/` directory contains all infrastructure-as-code for an AWS-based deployment.

### Directory structure

```
terraform/
├── main.tf          # VPC, subnets, NAT gateway, routing
├── variables.tf     # Input variables
├── outputs.tf       # Output values (ALB DNS, RDS endpoint, etc.)
├── versions.tf      # Provider version constraints
├── rds.tf           # PostgreSQL RDS instance
├── alarms.tf        # CloudWatch alarms
├── logging.tf       # CloudWatch log groups
├── envs/            # Per-environment variable files
│   ├── staging.tfvars
│   └── production.tfvars
└── scripts/         # Helper scripts
```

### Infrastructure overview

```
Internet → ALB (HTTPS) → ECS Fargate Tasks (private subnet)
                                  │
                           RDS PostgreSQL (private subnet)
                                  │
                         NAT Gateway → external APIs
```

### Initial setup

```bash
# Configure AWS credentials
aws configure

# Navigate to the terraform directory
cd terraform

# Initialise providers and modules
terraform init

# Preview the plan for staging
terraform plan -var-file=envs/staging.tfvars

# Apply to staging
terraform apply -var-file=envs/staging.tfvars
```

### Applying to production

```bash
terraform plan -var-file=envs/production.tfvars
terraform apply -var-file=envs/production.tfvars
```

Always review the plan output carefully before applying to production. Terraform will show every resource that will be created, modified, or destroyed.

### Key Terraform variables

| Variable | Description |
|----------|-------------|
| `environment` | `staging` or `production` |
| `vpc_cidr` | CIDR block for the VPC |
| `public_subnet_cidrs` | List of public subnet CIDRs (one per AZ) |
| `private_subnet_cidrs` | List of private subnet CIDRs (one per AZ) |

### Destroying an environment

```bash
# Only do this for non-production environments
terraform destroy -var-file=envs/staging.tfvars
```

---

## Blue-Green Deployment Strategy

Blue-green deployments enable zero-downtime releases by running two identical environments in parallel and switching traffic atomically.

### Overview

```
Load Balancer / Nginx
        │
        ├── Blue  (port 3000) ← active (live traffic)
        └── Green (port 3001) ← idle (next deployment target)
```

### Deployment files

| File | Purpose |
|------|---------|
| `docker-compose.blue.yml` | Blue environment on port 3000 |
| `docker-compose.green.yml` | Green environment on port 3001 |
| `scripts/blue-green-deploy.sh` | Deploy to the inactive slot |
| `scripts/rollback.sh` | Switch back to the previous slot |
| `.active-env` | Tracks the currently live slot (auto-managed) |

### Deploying a new version

```bash
# Make scripts executable (first time only)
chmod +x scripts/blue-green-deploy.sh scripts/rollback.sh

# Deploy image tagged v1.2.3 (defaults to "latest" if omitted)
./scripts/blue-green-deploy.sh v1.2.3
```

The script:
1. Builds the new Docker image
2. Starts the inactive environment
3. Runs health checks against `/api/health` (10 retries × 5 s)
4. Switches traffic by updating `.active-env`
5. Stops the old environment

If health checks fail the new environment is torn down — live traffic is never interrupted.

### Traffic switching

After updating `.active-env`, update your load balancer to point to the new port:

**Nginx:**
```nginx
upstream stellar_spend {
    server localhost:3000;   # change to 3001 for green
}
```
```bash
nginx -s reload
```

**AWS ALB:** Update the target group weights via the console or CLI.

### Docker single-container deployment

```bash
# Build
docker build -t stellar-spend:latest .

# Run
docker run -p 3000:3000 --env-file .env.local stellar-spend:latest
```

### Kubernetes deployment

```bash
# Create the secret from your env file
kubectl create secret generic stellar-spend-secrets --from-env-file=.env.local

# Apply the manifests
kubectl apply -f k8s/deployment.yaml

# Monitor the rollout
kubectl rollout status deployment/stellar-spend
```

---

## Pre-Deployment Checklist

Complete all items before deploying to production.

### Code readiness

- [ ] All CI checks pass (lint, type-check, unit tests, build, E2E)
- [ ] PR reviewed and approved
- [ ] Changelog / release notes updated
- [ ] Database migrations reviewed and tested against a staging snapshot
- [ ] No `.only` in test files

### Environment

- [ ] All required environment variables are set in the target environment
- [ ] `ALLOWED_ORIGINS` includes the production domain
- [ ] Paycrest webhook URL is set to the production endpoint
- [ ] Sentry DSN is set for both server and client

### Infrastructure

- [ ] Health check endpoint responds: `GET /api/health` → `{"status":"ok"}`
- [ ] Database connectivity verified from the deployment environment
- [ ] Vercel function duration limits are appropriate for the new code
- [ ] No secrets committed to the repository (`git log --all -- '*.env*'`)

### Rollback readiness

- [ ] Previous deployment URL recorded in the incident runbook
- [ ] On-call engineer notified of the deployment window
- [ ] Rollback procedure tested in staging

---

## Post-Deployment Verification

Run these checks immediately after every production deployment.

### 1. Health check

```bash
curl -s https://app.your-domain.com/api/health | jq .
# Expected: {"status":"ok","timestamp":"...","version":"0.1.0"}
```

### 2. Smoke test critical endpoints

```bash
# FX rates (no auth required)
curl -s https://app.your-domain.com/api/fx-rates | jq '.rates | length'

# API versioning
curl -s https://app.your-domain.com/api/versions | jq .
```

### 3. Verify Sentry is receiving events

In the Sentry dashboard, confirm that a test error appears within 2 minutes of deployment. If not, check that `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are set correctly.

### 4. Check Vercel function logs

Vercel dashboard → your project → Logs tab. Look for any unexpected 5xx responses in the first 5 minutes after deployment.

### 5. Confirm the deployed version

The `version` field in `/api/health` comes from `package.json`. Confirm it matches the expected release version.

### 6. Monitor error rate

Watch the Sentry error rate for 15 minutes post-deployment. A sudden spike compared to pre-deployment baseline is a signal to consider rollback.

---

## Rollback Procedures

### Vercel: instant rollback via dashboard

1. Vercel project → Deployments
2. Find the last known-good deployment
3. `...` → **Promote to Production**

This is instant — no rebuild required; the previous build artifacts are already cached.

### Vercel: rollback via CLI

```bash
# List recent production deployments
vercel ls --prod

# Promote a specific deployment to production
vercel promote <deployment-url>
```

### Vercel: rollback via git revert

```bash
# Revert the bad commit and push (triggers CI + auto-deploy)
git revert <bad-commit-sha>
git push origin main
```

Avoid `git reset --hard` + force push on `main`.

### Blue-green: rollback

```bash
./scripts/rollback.sh
```

This starts the previous slot, verifies health, switches traffic, and stops the bad slot.

### Kubernetes: rollback

```bash
# Undo the most recent rollout
kubectl rollout undo deployment/stellar-spend

# Verify the rollback
kubectl rollout status deployment/stellar-spend
```

### Environment variable rollback

If a bad env var caused the incident:

1. Vercel → Settings → Environment Variables → edit the affected variable
2. Vercel → Deployments → `...` → **Redeploy** on the last good deployment (picks up new env vars with old code)

### Verifying a successful rollback

```bash
curl -s https://app.your-domain.com/api/health | jq .
```

Confirm `"status":"ok"` and monitor Sentry for a drop in error rate within 5 minutes.

---

## Disaster Recovery

### Recovery Time Objective (RTO) and Recovery Point Objective (RPO)

| Tier | Scenario | Target RTO | Target RPO |
|------|----------|-----------|-----------|
| P1 | Full service outage | < 15 min | < 1 min (Vercel instant rollback) |
| P2 | Degraded performance | < 30 min | < 5 min |
| P3 | Non-critical feature broken | < 4 h | N/A |

### Scenario: Vercel deployment is healthy but API returns 5xx

1. Check Vercel function logs for error messages.
2. Check Sentry for the full stack trace.
3. If caused by a bad environment variable → edit in Vercel dashboard + redeploy.
4. If caused by bad code → `git revert` + push to trigger auto-deploy.

### Scenario: Database is unreachable

1. Check RDS status in AWS Console → RDS → Databases.
2. Verify security group rules allow inbound connections from ECS/Vercel IPs.
3. Check `DATABASE_URL` / connection pool settings in environment variables.
4. If the RDS instance is in a failed state, initiate a point-in-time restore:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier stellar-spend-production \
  --target-db-instance-identifier stellar-spend-production-restored \
  --restore-time 2024-06-15T10:00:00Z
```

Refer to `docs/backup-recovery.md` for the full database recovery runbook.

### Scenario: Paycrest webhook stops delivering

1. Verify the webhook URL in the Paycrest dashboard matches the current production domain.
2. Check `/api/webhooks/paycrest` logs for signature verification failures.
3. If the webhook secret has rotated, update `PAYCREST_WEBHOOK_SECRET` in Vercel and redeploy.
4. Use the Paycrest dashboard to resend failed webhook events after the fix is deployed.

### Scenario: All environments are down

1. Check the [Vercel status page](https://www.vercel-status.com) and [Stellar status page](https://status.stellar.org).
2. If Vercel is down, activate the Docker container fallback on a separate host:

```bash
# On a standby server with .env.local configured
docker build -t stellar-spend:latest .
docker run -d -p 3000:3000 --env-file .env.local stellar-spend:latest
# Update DNS to point to the standby host
```

3. Communicate outage status to users via your status page.

### Communication template

```
[INCIDENT] Stellar-Spend service degradation
Status: Investigating / Identified / Resolving / Resolved
Impact: [Describe what is broken]
ETA: [Estimated time to resolution]
Next update: [Time of next status update]
```

### Post-incident review

After every P1 or P2 incident, file a post-mortem within 48 hours covering:
- Timeline of events
- Root cause
- Impact scope
- Remediation steps taken
- Action items to prevent recurrence
