# Meta Marketing API Synchronization Specification

## 1. Overview
This document specifies the technical protocols, endpoints, field requirements, and error-handling strategies for synchronizing Meta Ads data into DeweyMKTapp.

## 2. API Endpoints & Field Mappings

### 2.1 Ad Account Info
- **Endpoint**: `GET /{graph_version}/act_{account_id}`
- **Required Fields**: `id,account_id,name,currency,timezone_name,account_status`
- **Required Permission**: `ads_read`

### 2.2 Campaigns
- **Endpoint**: `GET /{graph_version}/act_{account_id}/campaigns`
- **Required Fields**:
  - `id`: Stable Meta Campaign ID
  - `name`: Campaign name following naming conventions
  - `objective`: Outcome objective (`OUTCOMES_LEADS`, `OUTCOMES_MESSAGES`, etc.)
  - `status`, `effective_status`: Delivery status
  - `daily_budget`, `lifetime_budget`: Spend caps
  - `start_time`, `stop_time`, `updated_time`
- **Pagination**: Cursor-based using `limit=50` and `after` cursor

### 2.3 Ad Sets
- **Endpoint**: `GET /{graph_version}/act_{account_id}/adsets`
- **Required Fields**:
  - `id`: Stable Meta Ad Set ID
  - `campaign_id`: Parent Campaign reference
  - `name`: Ad set name
  - `status`, `effective_status`
  - `daily_budget`, `lifetime_budget`
  - `optimization_goal`, `billing_event`
  - `targeting`: Audience demographic, location, and interest targeting
  - `start_time`, `end_time`, `updated_time`

### 2.4 Ads & Creatives
- **Endpoint**: `GET /{graph_version}/act_{account_id}/ads`
- **Required Fields**:
  - `id`: Stable Meta Ad ID
  - `campaign_id`: Parent Campaign reference
  - `adset_id`: Parent Ad Set reference
  - `name`: Ad name following content naming conventions
  - `status`, `effective_status`
  - `creative{id,name,title,body,image_url,thumbnail_url}`
  - `preview_shareable_link`, `created_time`, `updated_time`

### 2.5 Daily Insights
- **Endpoint**: `GET /{graph_version}/act_{account_id}/insights`
- **Granularity**: `level=ad` and `level=campaign`
- **Time Window**: Daily breakdown (`time_increment=1`) over defined date ranges
- **Required Metrics**:
  - `spend`, `impressions`, `reach`, `clicks`, `cpc`, `cpm`, `ctr`
  - `actions`: Array of action objects `[{ action_type, value }]`
  - `action_values`: Array of conversion value objects
  - `date_start`, `date_stop`

## 3. Cursor-Based Pagination & Sample Completeness
- Every paginated call inspects `response.paging.cursors.after` and `response.paging.next`.
- **Relationship Categorization**:
  - `RELATIONSHIP_VALID`: Parent ID matches an entity present in the synchronized sample.
  - `PARENT_NOT_IN_SAMPLE`: Parent ID is referenced, but the parent entity was not included in the fetched batch due to sample limits or pagination thresholds. (Must NOT be flagged as orphan).
  - `ORPHAN_CONFIRMED`: Parent entity is confirmed missing only when the entire account catalog has been exhaustively fetched without match.

## 4. Rate Limiting & Transient Error Recovery
The synchronization client implements bounded exponential backoff with jitter:
- **Retryable HTTP / Meta Codes**:
  - `17`: User request limit reached
  - `613`: Calls to this API have exceeded the rate limit
  - `80000`: Temporary Meta API server-side issue
  - `2`: Temporary service unavailable
  - Transient network timeouts and socket hangups
- **Backoff Algorithm**:
  $$\text{Delay} = \text{baseDelay} \times 2^{\text{attempt} - 1} + \text{random}(0, 50\text{ms})$$
  - Max retries: 3 attempts
  - Base delay: 200ms

## 5. Idempotent Database Upsert Strategy (Stage 1B)
1. Unique constraints ensure upsert idempotency (`campaignId`, `adsetId`, `adId`).
2. Foreign key ordering:
   $$\text{AdAccount} \longrightarrow \text{Campaign} \longrightarrow \text{AdSet} \longrightarrow \text{Ad} \longrightarrow \text{InsightsDaily}$$
3. Insights records are keyed on `(adAccountId, level, entityId, date)` to eliminate double-counting on repeated runs.

