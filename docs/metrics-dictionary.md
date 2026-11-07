# DeweyMKTapp — Marketing Metrics Dictionary

## 1. Core Meta Delivery & Engagement Metrics

| Metric | Calculation / Source | Definition & Business Meaning |
|---|---|---|
| **Spend** | Meta Insights `spend` | Total advertising expenditure in VND. |
| **Impressions** | Meta Insights `impressions` | Total number of times ads appeared on screen. |
| **Reach** | Meta Insights `reach` | Number of unique users who saw the ads at least once. **Rule: Never sum daily reach across time periods.** Deduplicated reach from the reporting window must be used. |
| **Clicks** | Meta Insights `clicks` | Total clicks across all parts of the ad (including link, profile, expansion). |
| **CTR** | `(Clicks / Impressions) * 100` | Click-Through Rate expressed as a percentage. |
| **CPC** | `Spend / Clicks` | Average cost per click in VND. |
| **CPM** | `(Spend / Impressions) * 1000` | Cost per 1,000 impressions in VND. |

## 2. Lead & Conversion Metrics

### 2.1 Meta Leads vs CRM Qualified Leads
A strict boundary is maintained between **Meta advertising leads** and **downstream CRM admissions leads**:
- **Meta Leads**: High-funnel inbound contacts captured directly through Meta advertising channels (Instant Forms, Messenger conversations, Website Pixel forms).
- **CRM Qualified Leads (QL)**: Admissions candidates verified by school admissions counselors meeting Dewey enrollment criteria.

### 2.2 Meta Action Types Mapping
Meta returns conversion events in the `actions` array `[{ action_type, value }]`. These must be mapped without double-counting:

| Business Metric | Meta `action_type` | Description |
|---|---|---|
| **Instant Form Leads** | `lead`, `onsite_conversion.lead_grouped` | Submissions via native Facebook/Instagram Lead Forms. |
| **Website Leads** | `offsite_conversion.fb_pixel_lead` | Submissions via Dewey landing pages tracked by Meta Pixel / CAPI. |
| **Messaging Conversations** | `onsite_conversion.messaging_conversation_started_7d` | New messaging conversations initiated via Messenger / Direct. |
| **Messaging First Replies** | `onsite_conversion.messaging_first_reply` | Initial customer response in messaging funnel. |
| **Landing Page Views** | `landing_page_view` | Successful page load following an ad click. |
| **Link Clicks** | `link_click` | Clicks redirecting to destination URLs. |

### 2.3 Cost Per Result Metrics
- **CPL (Cost Per Lead)**:
  $$\text{CPL} = \frac{\text{Spend}}{\text{Meta Leads}}$$
- **Cost per Messaging Conversation**:
  $$\text{Cost per Conversation} = \frac{\text{Spend}}{\text{Messaging Conversations}}$$

## 3. Handling Unavailable CRM Metrics
During this development cycle, CRM integration is deferred. When CRM data is not connected:
- **Qualified Leads (QL)**: Display as `N/A`.
- **Cost per Qualified Lead (CPQL)**: Display as `N/A`.
- **Lead-to-QL Conversion Rate**: Display as `N/A`.
- **Rule**: Never replace unavailable CRM metrics with `0` or `0%`.

## 4. Aggregation Rules
1. **No Reach Summation**: Summing daily reach over $N$ days yields gross touchpoints, not unique reach. Only report deduplicated period reach or clearly label as "Average Daily Reach".
2. **Action Type Deduplication**: If a campaign tracks both `onsite_conversion.lead_grouped` and `lead`, the sync engine must ensure events are not double-counted when aggregating total Meta Leads.
3. **Pacing & Forecasting**:
   - Pacing: Percentage of allocated budget consumed relative to elapsed campaign duration.
   - Forecast: Projected end-of-period spend based on 7-day trailing velocity.

