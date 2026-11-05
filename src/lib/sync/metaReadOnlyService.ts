import {
  MetaApiService,
  MetaConnectionParam,
  MetaCampaignRecord,
  MetaAdSetRecord,
  MetaAdRecord,
  MetaInsightRecord,
  MetaAccountInfo,
  normalizeAdAccountId,
} from '@/lib/meta';

export interface ReadOnlyInspectOptions {
  adAccountId: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  sampleLimit?: number; // max 50, default 10
  maxPages?: number;    // max 5, default 2
}

export interface OrphanAdSetItem {
  adsetId: string;
  adsetName: string;
  campaignId: string;
}

export interface OrphanAdItem {
  adId: string;
  adName: string;
  adsetId: string;
  campaignId: string;
  reason: string;
}

export interface RelationshipValidationSummary {
  totalCampaigns: number;
  totalAdSets: number;
  totalAds: number;
  validAdSetToCampaignCount: number;
  orphanAdSetCount: number;
  orphanAdSets: OrphanAdSetItem[];
  validAdToAdSetCount: number;
  orphanAdCount: number;
  orphanAds: OrphanAdItem[];
}

export interface ReadOnlyInspectResult {
  isMockData: boolean;
  adAccount: MetaAccountInfo;
  tokenPermissions: {
    valid: boolean;
    hasAdsRead: boolean;
    hasBusinessManagement: boolean;
    permissions: string[];
    userId?: string;
    userName?: string;
  };
  campaigns: {
    count: number;
    pagesFetched: number;
    hasMore: boolean;
    nextCursor?: string;
    sample: MetaCampaignRecord[];
  };
  adsets: {
    count: number;
    pagesFetched: number;
    hasMore: boolean;
    nextCursor?: string;
    sample: MetaAdSetRecord[];
  };
  ads: {
    count: number;
    pagesFetched: number;
    hasMore: boolean;
    nextCursor?: string;
    sample: MetaAdRecord[];
  };
  insights: {
    dateRange: {
      dateFrom: string;
      dateTo: string;
    };
    campaignLevelSample: MetaInsightRecord[];
    adLevelSample: MetaInsightRecord[];
    campaignLevelCount: number;
    adLevelCount: number;
  };
  relationshipValidation: RelationshipValidationSummary;
  diagnostics: {
    warnings: string[];
    executionTimeMs: number;
    isReadOnly: true;
  };
}

export class MetaReadOnlySyncService {
  /**
   * Safe, read-only inspection of live/mock Meta Ads data for a specific Ad Account.
   * Guarantees ZERO database mutations and token payload sanitization.
   */
  public static async inspectAdAccount(
    connection: MetaConnectionParam,
    options: ReadOnlyInspectOptions
  ): Promise<ReadOnlyInspectResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);

    if (!normalizedAccountId) {
      throw new Error('Ad Account ID is required');
    }

    const decryptedToken = MetaApiService.getDecryptedToken(connection);
    const isMockData =
      decryptedToken.startsWith('EAABwXyzFake') ||
      decryptedToken === 'mock-token' ||
      decryptedToken.startsWith('test-token-');

    // 1. Inspect Token and Permissions
    const tokenInfo = await MetaApiService.getTokenPermissions(connection);
    if (!tokenInfo.hasAdsRead) {
      warnings.push('Token lacks ads_read permission. Ad data may be incomplete or restricted.');
    }

    // 2. Fetch Ad Account Details
    const adAccount = await MetaApiService.getAdAccount(normalizedAccountId, connection);

    const limit = Math.min(Math.max(options.sampleLimit || 10, 1), 50);
    const maxPages = Math.min(Math.max(options.maxPages || 2, 1), 5);

    // 3. Fetch Campaigns (paged)
    const campaignsResult = await MetaApiService.getCampaignsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 4. Fetch Ad Sets (paged)
    const adsetsResult = await MetaApiService.getAdSetsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 5. Fetch Ads (paged)
    const adsResult = await MetaApiService.getAdsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 6. Fetch Sample Insights (both campaign and ad level)
    const now = new Date();
    const defaultDateTo = now.toISOString().split('T')[0];
    const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const defaultDateFrom = past7Days.toISOString().split('T')[0];

    const dateFrom = options.dateFrom || defaultDateFrom;
    const dateTo = options.dateTo || defaultDateTo;

    let campaignInsights: MetaInsightRecord[] = [];
    let adInsights: MetaInsightRecord[] = [];

    try {
      const campInsightsRes = await MetaApiService.getInsightsPaged(
        normalizedAccountId,
        connection,
        'campaign',
        dateFrom,
        dateTo,
        { limit, maxPages: 1 }
      );
      campaignInsights = campInsightsRes.data;
    } catch (e: unknown) {
      warnings.push(`Campaign-level insights query notice: ${(e as Error).message}`);
    }

    try {
      const adInsightsRes = await MetaApiService.getInsightsPaged(
        normalizedAccountId,
        connection,
        'ad',
        dateFrom,
        dateTo,
        { limit, maxPages: 1 }
      );
      adInsights = adInsightsRes.data;
    } catch (e: unknown) {
      warnings.push(`Ad-level insights query notice: ${(e as Error).message}`);
    }

    // 7. Validate Parent-Child Relationships
    const campaignIdSet = new Set(campaignsResult.data.map(c => c.id));
    const adsetIdSet = new Set(adsetsResult.data.map(as => as.id));

    const orphanAdSets: OrphanAdSetItem[] = [];
    let validAdSetToCampaignCount = 0;

    for (const adset of adsetsResult.data) {
      if (adset.campaign_id && campaignIdSet.has(adset.campaign_id)) {
        validAdSetToCampaignCount++;
      } else {
        orphanAdSets.push({
          adsetId: adset.id,
          adsetName: adset.name || 'Unknown AdSet',
          campaignId: adset.campaign_id || '',
        });
      }
    }

    const orphanAds: OrphanAdItem[] = [];
    let validAdToAdSetCount = 0;

    for (const ad of adsResult.data) {
      const hasParentAdSet = !!(ad.adset_id && adsetIdSet.has(ad.adset_id));
      const hasParentCampaign = !!(ad.campaign_id && campaignIdSet.has(ad.campaign_id));

      if (hasParentAdSet && hasParentCampaign) {
        validAdToAdSetCount++;
      } else {
        const reasons: string[] = [];
        if (!hasParentAdSet) reasons.push(`adset_id '${ad.adset_id}' not found in fetched adsets`);
        if (!hasParentCampaign) reasons.push(`campaign_id '${ad.campaign_id}' not found in fetched campaigns`);

        orphanAds.push({
          adId: ad.id,
          adName: ad.name || 'Unknown Ad',
          adsetId: ad.adset_id || '',
          campaignId: ad.campaign_id || '',
          reason: reasons.join('; '),
        });
      }
    }

    if (orphanAdSets.length > 0) {
      warnings.push(`Detected ${orphanAdSets.length} AdSet(s) without matching parent Campaign in the fetched sample.`);
    }
    if (orphanAds.length > 0) {
      warnings.push(`Detected ${orphanAds.length} Ad(s) without matching parent AdSet or Campaign in the fetched sample.`);
    }

    const relationshipValidation: RelationshipValidationSummary = {
      totalCampaigns: campaignsResult.data.length,
      totalAdSets: adsetsResult.data.length,
      totalAds: adsResult.data.length,
      validAdSetToCampaignCount,
      orphanAdSetCount: orphanAdSets.length,
      orphanAdSets,
      validAdToAdSetCount,
      orphanAdCount: orphanAds.length,
      orphanAds,
    };

    const executionTimeMs = Date.now() - startTime;

    return {
      isMockData,
      adAccount,
      tokenPermissions: {
        valid: tokenInfo.valid,
        hasAdsRead: tokenInfo.hasAdsRead,
        hasBusinessManagement: tokenInfo.hasBusinessManagement,
        permissions: tokenInfo.permissions,
        userId: tokenInfo.userId,
        userName: tokenInfo.userName,
      },
      campaigns: {
        count: campaignsResult.totalFetched,
        pagesFetched: campaignsResult.pagesFetched,
        hasMore: campaignsResult.hasMore,
        nextCursor: campaignsResult.nextCursor,
        sample: campaignsResult.data.slice(0, limit),
      },
      adsets: {
        count: adsetsResult.totalFetched,
        pagesFetched: adsetsResult.pagesFetched,
        hasMore: adsetsResult.hasMore,
        nextCursor: adsetsResult.nextCursor,
        sample: adsetsResult.data.slice(0, limit),
      },
      ads: {
        count: adsResult.totalFetched,
        pagesFetched: adsResult.pagesFetched,
        hasMore: adsResult.hasMore,
        nextCursor: adsResult.nextCursor,
        sample: adsResult.data.slice(0, limit),
      },
      insights: {
        dateRange: {
          dateFrom,
          dateTo,
        },
        campaignLevelSample: campaignInsights.slice(0, limit),
        adLevelSample: adInsights.slice(0, limit),
        campaignLevelCount: campaignInsights.length,
        adLevelCount: adInsights.length,
      },
      relationshipValidation,
      diagnostics: {
        warnings,
        executionTimeMs,
        isReadOnly: true,
      },
    };
  }
}

