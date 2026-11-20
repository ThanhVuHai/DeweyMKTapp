import {
  MetaApiService,
  MetaConnectionParam,
  MetaCampaignRecord,
  MetaAdSetRecord,
  MetaAdRecord,
  MetaInsightRecord,
  MetaAccountInfo,
  normalizeAdAccountId,
  isMockToken,
} from '@/lib/meta';

export interface ReadOnlyInspectOptions {
  adAccountId: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  sampleLimit?: number; // max 50, default 10
  maxPages?: number;    // max 5, default 2
}

export type RelationshipStatus = 'RELATIONSHIP_VALID' | 'PARENT_NOT_IN_SAMPLE' | 'ORPHAN_CONFIRMED';

export interface OrphanAdSetItem {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  status?: RelationshipStatus;
  reason?: string;
}

export interface OrphanAdItem {
  adId: string;
  adName: string;
  adsetId: string;
  campaignId: string;
  status?: RelationshipStatus;
  reason: string;
}

export interface RelationshipValidationSummary {
  totalCampaigns: number;
  totalAdSets: number;
  totalAds: number;
  validAdSetToCampaignCount: number;
  parentNotInSampleAdSetCount: number;
  orphanAdSetCount: number;
  orphanAdSets: OrphanAdSetItem[];
  validAdToAdSetCount: number;
  parentNotInSampleAdCount: number;
  orphanAdCount: number;
  orphanAds: OrphanAdItem[];
}

export interface ReadOnlyInspectResult {
  dataMode: 'LIVE' | 'MOCK';
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
  accountInsightsSummary?: MetaInsightRecord | null;
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
    accountLevel: MetaInsightRecord | null;
    campaignLevelSample: MetaInsightRecord[];
    adLevelSample: MetaInsightRecord[];
    campaignLevelCount: number;
    adLevelCount: number;
    observedActionTypes?: string[];
  };
  relationshipValidation: RelationshipValidationSummary;
  diagnostics: {
    dataMode: 'LIVE' | 'MOCK';
    requestedAccountId: string;
    normalizedAccountId: string;
    graphApiVersion: string;
    dateRange: {
      dateFrom: string;
      dateTo: string;
    };
    rawCounts: {
      campaigns: number;
      adsets: number;
      ads: number;
      accountInsightsFound: boolean;
      campaignInsights: number;
      adInsights: number;
    };
    pagination: {
      campaignsHasMore: boolean;
      adsetsHasMore: boolean;
      adsHasMore: boolean;
    };
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
    const limit = Math.min(options.sampleLimit || 10, 50);
    const maxPages = Math.min(options.maxPages || 2, 5);

    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);
    if (!normalizedAccountId) {
      throw new Error('adAccountId is required and must not be empty');
    }

    const decryptedToken = MetaApiService.getDecryptedToken(connection);
    const isMockData = isMockToken(decryptedToken);
    const dataMode: 'LIVE' | 'MOCK' = isMockData ? 'MOCK' : 'LIVE';

    // 1. Validate Token & Permissions
    const tokenInfo = await MetaApiService.getTokenPermissions(connection);
    if (!tokenInfo.hasAdsRead) {
      warnings.push("Token lacks 'ads_read' permission. Full ads synchronization will be blocked.");
    }
    if (!tokenInfo.hasBusinessManagement) {
      // Non-blocking notice
      warnings.push("Token lacks 'business_management' permission. Business Manager profile metadata is bypassed.");
    }

    // 2. Fetch Ad Account Details (uses only ads_read)
    const adAccount = await MetaApiService.getAdAccount(normalizedAccountId, connection);

    // 3. Fetch Campaigns (paged sample)
    const campaignsResult = await MetaApiService.getCampaignsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 4. Fetch Ad Sets (paged sample)
    const adsetsResult = await MetaApiService.getAdSetsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 5. Fetch Ads (paged sample)
    const adsResult = await MetaApiService.getAdsPaged(
      normalizedAccountId,
      connection,
      { limit, maxPages }
    );

    // 6. Date Range Handling (Explicitly supplied date range preserved; defaults to last 30 days)
    const now = new Date();
    const defaultEnd = now.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultStart = thirtyDaysAgo.toISOString().split('T')[0];
    const dateFrom = options.dateFrom || defaultStart;
    const dateTo = options.dateTo || defaultEnd;

    // 6a. Direct Account-level Insights (queried directly BEFORE campaign/ad levels)
    let accountLevelInsight: MetaInsightRecord | null = null;
    try {
      accountLevelInsight = await MetaApiService.getAccountInsights(
        normalizedAccountId,
        connection,
        dateFrom,
        dateTo
      );
    } catch (e: unknown) {
      warnings.push(`Could not fetch account-level aggregate insights: ${(e as Error).message}`);
    }

    // 6b. Campaign-level Sample Insights
    let campaignInsights: MetaInsightRecord[] = [];
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
      warnings.push(`Could not fetch campaign-level sample insights: ${(e as Error).message}`);
    }

    // 6c. Ad-level Sample Insights
    let adInsights: MetaInsightRecord[] = [];
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
      warnings.push(`Could not fetch ad-level sample insights: ${(e as Error).message}`);
    }

    // 7. Validate Parent-Child Relationships
    const campaignIdSet = new Set(campaignsResult.data.map(c => c.id));
    const adsetIdSet = new Set(adsetsResult.data.map(as => as.id));

    const orphanAdSets: OrphanAdSetItem[] = [];
    let validAdSetToCampaignCount = 0;
    let parentNotInSampleAdSetCount = 0;

    for (const adset of adsetsResult.data) {
      if (adset.campaign_id && campaignIdSet.has(adset.campaign_id)) {
        validAdSetToCampaignCount++;
      } else {
        const isSampleLimited = campaignsResult.hasMore;
        const status: RelationshipStatus = isSampleLimited ? 'PARENT_NOT_IN_SAMPLE' : 'ORPHAN_CONFIRMED';
        if (status === 'PARENT_NOT_IN_SAMPLE') {
          parentNotInSampleAdSetCount++;
        }
        orphanAdSets.push({
          adsetId: adset.id,
          adsetName: adset.name || 'Unknown AdSet',
          campaignId: adset.campaign_id || '',
          status,
          reason: isSampleLimited
            ? `campaign_id '${adset.campaign_id}' not found in fetched sample (more campaign pages available in account)`
            : `campaign_id '${adset.campaign_id}' does not exist in any campaign in the account`,
        });
      }
    }

    const orphanAds: OrphanAdItem[] = [];
    let validAdToAdSetCount = 0;
    let parentNotInSampleAdCount = 0;

    for (const ad of adsResult.data) {
      const hasParentAdSet = !!(ad.adset_id && adsetIdSet.has(ad.adset_id));
      const hasParentCampaign = !!(ad.campaign_id && campaignIdSet.has(ad.campaign_id));

      if (hasParentAdSet && hasParentCampaign) {
        validAdToAdSetCount++;
      } else {
        const isSampleLimited = campaignsResult.hasMore || adsetsResult.hasMore;
        const status: RelationshipStatus = isSampleLimited ? 'PARENT_NOT_IN_SAMPLE' : 'ORPHAN_CONFIRMED';
        if (status === 'PARENT_NOT_IN_SAMPLE') {
          parentNotInSampleAdCount++;
        }
        const reasons: string[] = [];
        if (!hasParentAdSet) {
          reasons.push(
            adsetsResult.hasMore
              ? `adset_id '${ad.adset_id}' not found in sample (more adset pages available)`
              : `adset_id '${ad.adset_id}' confirmed absent from account`
          );
        }
        if (!hasParentCampaign) {
          reasons.push(
            campaignsResult.hasMore
              ? `campaign_id '${ad.campaign_id}' not found in sample (more campaign pages available)`
              : `campaign_id '${ad.campaign_id}' confirmed absent from account`
          );
        }

        orphanAds.push({
          adId: ad.id,
          adName: ad.name || 'Unknown Ad',
          adsetId: ad.adset_id || '',
          campaignId: ad.campaign_id || '',
          status,
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

    // Extract all observed action types across all insights (account, campaign, ad)
    const observedActionTypesSet = new Set<string>();
    const allInsights = [
      ...(accountLevelInsight ? [accountLevelInsight] : []),
      ...campaignInsights,
      ...adInsights,
    ];
    for (const ins of allInsights) {
      if (Array.isArray(ins.actions)) {
        for (const act of ins.actions) {
          if (act?.action_type) observedActionTypesSet.add(act.action_type);
        }
      }
    }
    const observedActionTypes = Array.from(observedActionTypesSet);

    const relationshipValidation: RelationshipValidationSummary = {
      totalCampaigns: campaignsResult.data.length,
      totalAdSets: adsetsResult.data.length,
      totalAds: adsResult.data.length,
      validAdSetToCampaignCount,
      parentNotInSampleAdSetCount,
      orphanAdSetCount: orphanAdSets.length,
      orphanAdSets,
      validAdToAdSetCount,
      parentNotInSampleAdCount,
      orphanAdCount: orphanAds.length,
      orphanAds,
    };

    const executionTimeMs = Date.now() - startTime;

    return {
      dataMode,
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
      accountInsightsSummary: accountLevelInsight,
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
        accountLevel: accountLevelInsight,
        campaignLevelSample: campaignInsights.slice(0, limit),
        adLevelSample: adInsights.slice(0, limit),
        campaignLevelCount: campaignInsights.length,
        adLevelCount: adInsights.length,
        observedActionTypes,
      },
      relationshipValidation,
      diagnostics: {
        dataMode,
        requestedAccountId: options.adAccountId,
        normalizedAccountId,
        graphApiVersion: connection.graphApiVersion || 'v25.0',
        dateRange: {
          dateFrom,
          dateTo,
        },
        rawCounts: {
          campaigns: campaignsResult.data.length,
          adsets: adsetsResult.data.length,
          ads: adsResult.data.length,
          accountInsightsFound: !!accountLevelInsight,
          campaignInsights: campaignInsights.length,
          adInsights: adInsights.length,
        },
        pagination: {
          campaignsHasMore: campaignsResult.hasMore,
          adsetsHasMore: adsetsResult.hasMore,
          adsHasMore: adsResult.hasMore,
        },
        warnings,
        executionTimeMs,
        isReadOnly: true,
      },
    };
  }
}
