# DeweyMKTapp — System Architecture Specification

## 1. Executive Summary
DeweyMKTapp is a specialized marketing analytics platform built for The Dewey Schools. Its core mission is to provide granular visibility, performance monitoring, campaign classification, and actionable insights across all Meta Advertising assets running for campuses nationwide.

## 2. Technology Stack
- **Framework**: Next.js 16.4.4 (App Router)
- **UI & Visualization**: React 19, Tailwind CSS v4, Lucide React, Recharts
- **Language**: TypeScript 5 (Strict mode)
- **Database & ORM**: Neon PostgreSQL, Prisma ORM 6.19.3
- **External Integration**: Meta Graph API v25.0 (Marketing API)
- **Hosting & Infrastructure**: Vercel (Edge & Serverless Node.js Runtime)

## 3. End-to-End Data Pipeline Architecture
The system operates across five decoupled architectural layers:

```
┌────────────────────────────────────────────────────────┐
│               1. Meta Marketing API                    │
│   (Graph API v25.0 - Ad Accounts, Campaigns, Ads)      │
└──────────────────────────┬─────────────────────────────┘
                           │ Cursor-based pagination & retries
                           ▼
┌────────────────────────────────────────────────────────┐
│           2. Meta Data Synchronization Engine          │
│  - Bounded exponential backoff on rate limits          │
│  - Relationship validator (Valid, Unsampled, Orphan)   │
│  - Chunked execution within serverless time budgets    │
└──────────────────────────┬─────────────────────────────┘
                           │ Idempotent batch upserts
                           ▼
┌────────────────────────────────────────────────────────┐
│           3. Neon PostgreSQL (Normalized Storage)      │
│  - MetaConnection, AdAccount                           │
│  - Campaign, AdSet, Ad, AdCreative                     │
│  - InsightsDaily (ad-level & campaign-level)           │
│  - ContentMapping, SyncJob, AuditLog                   │
└──────────────────────────┬─────────────────────────────┘
                           │ Rule-based deterministic parsing
                           ▼
┌────────────────────────────────────────────────────────┐
│       4. Campaign Classification Engine (V1)           │
│  - Campaign: Employee, Campus, Objective, TS, Date     │
│  - Content: Content Code, Format, Angle, Niche         │
│  - Immutable manual overrides protection               │
└──────────────────────────┬─────────────────────────────┘
                           │ Aggregations & pacing
                           ▼
┌────────────────────────────────────────────────────────┐
│        5. Meta Ads Performance Dashboard               │
│  - Overview, Executive, Ads Optimization, Funnel       │
│  - Data Reconciliation (Reported vs Actual spend)      │
└────────────────────────────────────────────────────────┘
```

## 4. Database Models & Schema Boundaries
- **Connection Boundary**:
  - `MetaConnection`: Manages encrypted access tokens (AES-256-CBC), Graph API version, sync schedules.
  - `AdAccount`: Stores ad accounts linked to connections with currency, timezone, and operational status.
- **Entity Hierarchy Boundary**:
  - `Campaign`: Represents top-level Meta campaign (`campaign_id`, `name`, `objective`, `status`, `budget`).
  - `AdSet`: Represents targeting/optimization group (`adset_id`, `campaign_id`, `targeting`).
  - `Ad`: Represents individual ad unit (`ad_id`, `adset_id`, `campaign_id`, `name`, `status`).
  - `AdCreative`: Stores creative assets, titles, copy, and thumbnails.
- **Metrics Boundary**:
  - `InsightsDaily`: Granular daily snapshots indexed by entity ID, date, and level (`campaign`, `adset`, `ad`).
- **Classification Boundary**:
  - `ContentMapping`: Stores mapped metadata (Campus, Grade, Funnel Stage, Content ID). Manual overrides are flagged and protected against automatic overwrite.
- **CRM Boundary (Preserved for Future Phase)**:
  - `CrmLead`, `Contract`, `Student`: Retained as schema placeholders without interference during this Meta Ads-focused phase.

## 5. Security Architecture
- **Token Protection**: Access tokens are encrypted at rest using AES-256-CBC with a 16-byte initialization vector (`iv:ciphertext`). Tokens are masked (`***...***`) when returned to client interfaces.
- **Scope & Permissions**: The application strictly requires `ads_read` for reading advertising objects and insights. The `business_management` permission is optional and gracefully bypassed if absent.
- **Audit Logging**: All connection modifications, manual content mappings, and synchronization runs are recorded in `AuditLog`.

