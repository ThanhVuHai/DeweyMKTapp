<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DeweyMKTapp — Master Agent Development Rules

## 1. Project Context & Environment
- **Project**: Marketing Analytics & Meta Ads Synchronization Platform for The Dewey Schools.
- **Repository**: `https://github.com/ThanhVuHai/DeweyMKTapp`
- **Active Branch**: `stage-1a-meta-read-only`
- **Tech Stack**: Next.js 16.4.4, React 19, TypeScript strict, Prisma 6, Neon PostgreSQL, Meta Marketing API.
- **CRM Integration**: Currently DEFERRED for this development cycle. Preserve all existing CRM schemas, models, and fields for future integration.

## 2. Core Architecture Pipeline
```
Meta Marketing API
  ↳ Meta Data Synchronization Engine
    ↳ Neon PostgreSQL (Normalized Storage)
      ↳ Campaign Classification Engine (V1)
        ↳ Meta Ads Performance Dashboard
          ↳ Data Reconciliation
```

## 3. Strict Operating Principles
1. **Zero Guesswork / Verification First**: Audit actual codebase before changes. Never claim success without running quality gates.
2. **Layer Separation**: Keep Sync Engine, Database Models, Classification Logic, and Dashboard UI strictly decoupled.
3. **Identifier Stability**: Use Meta entity IDs (`campaign_id`, `adset_id`, `ad_id`, `account_id`) as stable primary references.
4. **Data Integrity & Idempotency**: All synchronizations and upserts must be idempotent. Never fabricate missing metrics or mappings.
5. **Security & Zero Token Leakage**:
   - Meta Access Tokens and encryption keys must NEVER be exposed in logs, API responses, or UI.
   - Never disable authentication to bypass errors.
   - Use AES-256-CBC token encryption at rest.
6. **Database Protection**:
   - Never reset production database.
   - Do not execute unapproved Prisma migrations.
   - Never overwrite manual user mappings.
   - Zero DB writes during read-only inspection tasks.
7. **Metric Integrity**:
   - Never sum daily reach across reporting periods.
   - Preserve clear distinction between Meta Leads and CRM Qualified Leads.
   - When CRM data is absent, output `N/A` (never substitute with 0).
   - Never double-count overlapping Meta action types.

## 4. Required Quality Gates (Run for every implementation task)
```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## 5. Five-Task Sequential Execution Protocol
1. **Task 1**: Authentication Fix & Live Meta Validation.
2. **Task 2**: Meta Sync Engine & Database Persistence.
3. **Task 3**: Auto Classification & Mapping.
4. **Task 4**: Meta Ads Dashboard.
5. **Task 5**: Reconciliation & Production Readiness.
*Note: Complete each task, verify quality gates, and stop for approval before proceeding to the next task.*
