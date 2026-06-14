import { decrypt } from './crypto';

export interface MetaConnectionParam {
  encryptedAccessToken: string;
  graphApiVersion?: string;
}

export interface MetaAccountInfo {
  accountId: string;
  accountName: string;
  currency: string;
  timezoneName: string;
  businessId?: string;
  status?: string;
}

/**
 * MetaApiService integrates directly with the Meta Marketing API
 */
export class MetaApiService {
  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
    };
  }

  private static getDecryptedToken(connection: MetaConnectionParam): string {
    const rawToken = connection.encryptedAccessToken;
    if (rawToken.includes(':')) {
      return decrypt(rawToken);
    }
    return rawToken; // already decrypted or mock plaintext
  }

  /**
   * Helper to make requests to the Meta Graph API.
   * Handles dynamic API versioning and token assignment.
   */
  private static async requestMetaAPI(
    endpoint: string,
    connection: MetaConnectionParam,
    params: Record<string, string> = {}
  ): Promise<any> {
    const version = connection.graphApiVersion || 'v25.0';
    const token = this.getDecryptedToken(connection);
    
    // Check for demo token to run mock response
    if (token.startsWith('EAABwXyzFake') || token === 'mock-token') {
      return this.handleMockRequest(endpoint, params);
    }

    const queryParams = new URLSearchParams({
      access_token: token,
      ...params,
    });

    const url = `https://graph.facebook.com/${version}/${endpoint}?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data?.error?.message || 'Meta API request failed';
        const code = data?.error?.code;
        const subcode = data?.error?.error_subcode;

        console.error(`Meta API Error [${code}:${subcode}]: ${errorMsg}`);
        
        // Throw semantic errors based on Facebook API specs
        if (code === 190 || subcode === 463 || subcode === 467) {
          throw new Error('Token invalid or expired');
        }
        if (code === 10 || code === 200 || code === 278) {
          throw new Error('Missing ads_read permission');
        }
        if (code === 17 || code === 80000) {
          throw new Error('API rate limit reached');
        }
        throw new Error(errorMsg);
      }

      return data;
    } catch (error: any) {
      if (error.message?.includes('Token invalid') || error.message?.includes('permission') || error.message?.includes('rate limit')) {
        throw error;
      }
      throw new Error(`Connection timeout or network error: ${error.message}`);
    }
  }

  /**
   * Mock request handler for demo purposes when using dummy tokens
   */
  private static handleMockRequest(endpoint: string, params: Record<string, string>): any {
    console.log(`[Demo API Mode] Intercepted endpoint: ${endpoint}`);
    
    if (endpoint === 'me') {
      return { id: 'demo_user_123', name: 'Dewey Demo Manager' };
    }
    
    if (endpoint === 'me/adaccounts') {
      return {
        data: [
          {
            id: 'act_2938472948',
            name: 'Dewey School Global Campaigns',
            currency: 'VND',
            timezone_name: 'Asia/Ho_Chi_Minh',
            business: { id: 'biz_8899', name: 'Dewey Education Group' },
            account_status: 1
          }
        ]
      };
    }

    if (endpoint.includes('insights')) {
      // Return bare-minimum structure, actual mock data populated via seeder
      return { data: [] };
    }

    // Default structure lists for campaigns/adsets/ads
    return { data: [] };
  }

  /**
   * Validate standard connection credential
   */
  public static async validateAccessToken(connection: MetaConnectionParam): Promise<boolean> {
    try {
      const data = await this.requestMetaAPI('me', connection);
      return !!data.id;
    } catch (error) {
      console.error('Validation failed:', error);
      throw error;
    }
  }

  /**
   * Fetch list of Ad Accounts connected to the credentials
   */
  public static async getAdAccounts(connection: MetaConnectionParam): Promise<MetaAccountInfo[]> {
    const data = await this.requestMetaAPI('me/adaccounts', connection, {
      fields: 'id,name,currency,timezone_name,business,account_status',
      limit: '50'
    });

    if (!data.data) return [];

    return data.data.map((acc: any) => ({
      accountId: acc.id, // e.g. act_123456
      accountName: acc.name,
      currency: acc.currency,
      timezoneName: acc.timezone_name,
      businessId: acc.business?.id,
      status: acc.account_status === 1 ? 'ACTIVE' : 'DISABLED',
    }));
  }

  /**
   * Fetch list of Campaigns in an Account
   */
  public static async getCampaigns(adAccountId: string, connection: MetaConnectionParam): Promise<any[]> {
    // Standard pagination helper can be used
    let results: any[] = [];
    let endpoint = `${adAccountId}/campaigns`;
    let params: Record<string, string> = {
      fields: 'id,name,objective,buying_type,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
      limit: '100'
    };

    const response = await this.requestMetaAPI(endpoint, connection, params);
    if (response.data) results = response.data;
    
    return results;
  }

  /**
   * Fetch list of Ad Sets in an Account
   */
  public static async getAdSets(adAccountId: string, connection: MetaConnectionParam): Promise<any[]> {
    let results: any[] = [];
    const response = await this.requestMetaAPI(`${adAccountId}/adsets`, connection, {
      fields: 'id,campaign_id,name,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,targeting,status,effective_status,start_time,end_time',
      limit: '100'
    });
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Fetch list of Ads in an Account
   */
  public static async getAds(adAccountId: string, connection: MetaConnectionParam): Promise<any[]> {
    let results: any[] = [];
    const response = await this.requestMetaAPI(`${adAccountId}/ads`, connection, {
      fields: 'id,campaign_id,adset_id,name,creative,status,effective_status,created_time,updated_time',
      limit: '100'
    });
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Fetch list of Creatives in an Account
   */
  public static async getCreatives(adAccountId: string, connection: MetaConnectionParam): Promise<any[]> {
    let results: any[] = [];
    const response = await this.requestMetaAPI(`${adAccountId}/adcreatives`, connection, {
      fields: 'id,name,title,body,image_url,thumbnail_url,video_id,object_story_id,call_to_action_type,object_url',
      limit: '100'
    });
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Get Performance Insights for an account at a given level (campaign, adset, ad)
   */
  public static async getInsights(
    adAccountId: string,
    connection: MetaConnectionParam,
    level: 'campaign' | 'adset' | 'ad',
    dateFrom: string,
    dateTo: string
  ): Promise<any[]> {
    let results: any[] = [];
    const response = await this.requestMetaAPI(`${adAccountId}/insights`, connection, {
      level,
      time_increment: '1',
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      fields: 'date_start,date_stop,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type,video_3sec_video_view,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions',
      limit: '100'
    });
    
    if (response.data) results = response.data;
    return results;
  }
}
