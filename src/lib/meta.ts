import { decrypt } from './crypto';

export interface MetaConnectionParam {
  encryptedAccessToken?: string;
  accessToken?: string;
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

export interface MetaCampaignRecord {
  id: string;
  name?: string;
  objective?: string;
  buying_type?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
}

export interface MetaAdSetRecord {
  id: string;
  campaign_id?: string;
  name?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  targeting?: Record<string, unknown>;
  status?: string;
  effective_status?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaAdRecord {
  id: string;
  campaign_id?: string;
  adset_id?: string;
  name?: string;
  creative?: { id?: string };
  status?: string;
  effective_status?: string;
  created_time?: string;
  updated_time?: string;
}

export interface MetaCreativeRecord {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_id?: string;
  call_to_action_type?: string;
  object_url?: string;
}

export interface MetaInsightRecord {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  video_3sec_video_view?: Array<{ action_type: string; value: string }>;
  video_thruplay_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p25_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p50_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p75_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p95_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p100_watched_actions?: Array<{ action_type: string; value: string }>;
  [key: string]: unknown;
}

export interface MetaPagingCursors {
  before?: string;
  after?: string;
}

export interface MetaPagingInfo {
  cursors?: MetaPagingCursors;
  next?: string;
  previous?: string;
}

export interface MetaPaginatedResponse<T> {
  data?: T[];
  paging?: MetaPagingInfo;
}

export interface MetaPaginationOptions {
  limit?: number;
  maxPages?: number;
  afterCursor?: string;
  retryOptions?: {
    maxRetries?: number;
    baseDelayMs?: number;
  };
}

export interface MetaPaginatedResult<T> {
  data: T[];
  pagesFetched: number;
  totalFetched: number;
  hasMore: boolean;
  nextCursor?: string;
}

interface MetaRawAccount {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

export type MetaErrorCategory =
  | 'TOKEN_EXPIRED'
  | 'MISSING_ADS_READ'
  | 'MISSING_BUSINESS_MANAGEMENT'
  | 'ACCOUNT_NOT_ACCESSIBLE'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'API_ERROR';

export class MetaApiError extends Error {
  public code?: number;
  public subcode?: number;
  public category: MetaErrorCategory;
  public userMessage: string;
  public technicalDetails?: string;

  constructor(
    message: string,
    options?: {
      code?: number;
      subcode?: number;
      category?: MetaErrorCategory;
      userMessage?: string;
      technicalDetails?: string;
    }
  ) {
    super(message);
    this.name = 'MetaApiError';
    this.code = options?.code;
    this.subcode = options?.subcode;
    this.category = options?.category || 'API_ERROR';
    this.userMessage = options?.userMessage || message;
    this.technicalDetails = options?.technicalDetails || message;
  }
}

/**
 * Normalizes an Ad Account ID into standard Meta format 'act_<numeric_id>'.
 * E.g., '2938472948' -> 'act_2938472948', 'act_2938472948' -> 'act_2938472948'
 */
export function normalizeAdAccountId(id: string): string {
  if (!id) return '';
  const trimmed = id.trim();
  if (trimmed.startsWith('act_')) {
    return trimmed;
  }
  return `act_${trimmed}`;
}

/**
 * Parses raw Meta Graph API error response into structured MetaApiError
 * with actionable Vietnamese instructions for the user.
 */
export function parseMetaError(errorData: unknown): MetaApiError {
  const err = (errorData as { error?: { code?: number; error_subcode?: number; message?: string } })?.error ||
    (errorData as { code?: number; error_subcode?: number; message?: string }) ||
    {};
  const code = err.code;
  const subcode = err.error_subcode;
  const rawMsg = err.message || 'Meta API request failed';

  // 1. Token Expired / Invalid
  if (
    code === 190 ||
    subcode === 463 ||
    subcode === 467 ||
    rawMsg.includes('Session has expired') ||
    rawMsg.includes('Invalid OAuth access token') ||
    rawMsg.includes('Error validating access token')
  ) {
    return new MetaApiError(rawMsg, {
      code,
      subcode,
      category: 'TOKEN_EXPIRED',
      userMessage: 'Access Token đã hết hạn hoặc không hợp lệ. Vui lòng tạo Token mới từ Meta for Developers và cập nhật lại cấu hình kết nối.',
      technicalDetails: `Meta OAuthException (code ${code}, subcode ${subcode}): ${rawMsg}`,
    });
  }

  // 2. Business Management Permission Error
  if (rawMsg.includes('business_management')) {
    return new MetaApiError(rawMsg, {
      code: code || 100,
      subcode,
      category: 'MISSING_BUSINESS_MANAGEMENT',
      userMessage: 'Yêu cầu quyền business_management để đọc thông tin Business Manager. Với tính năng đọc và phân tích quảng cáo cơ bản, hệ thống chỉ cần quyền ads_read.',
      technicalDetails: `Meta Permission Error (code ${code}): ${rawMsg}`,
    });
  }

  // 3. Missing ads_read / Advertising Permission
  if (
    code === 10 ||
    code === 200 ||
    code === 278 ||
    rawMsg.includes('ads_read') ||
    rawMsg.includes('Requires ads_read permission')
  ) {
    return new MetaApiError(rawMsg, {
      code,
      subcode,
      category: 'MISSING_ADS_READ',
      userMessage: 'Token thiếu quyền ads_read. Vui lòng cấp quyền ads_read cho token trong Meta for Developers hoặc Meta App để truy cập dữ liệu quảng cáo.',
      technicalDetails: `Meta Permission Error (code ${code}): ${rawMsg}`,
    });
  }

  // 4. Account Not Accessible / Object does not exist / Not found
  if (
    rawMsg.includes('Unsupported get request') ||
    rawMsg.includes('does not exist') ||
    rawMsg.includes('cannot be loaded due to missing permissions') ||
    code === 803
  ) {
    return new MetaApiError(rawMsg, {
      code,
      subcode,
      category: 'ACCOUNT_NOT_ACCESSIBLE',
      userMessage: 'Không tìm thấy hoặc Token không có quyền truy cập Ad Account này. Vui lòng kiểm tra lại Ad Account ID (dạng act_xxxxxxxx) và phân quyền của bạn trong Trình quản lý quảng cáo.',
      technicalDetails: `Meta Account Access Error (code ${code}): ${rawMsg}`,
    });
  }

  // 5. Rate Limit
  if (code === 17 || code === 80000 || code === 613 || rawMsg.includes('rate limit')) {
    return new MetaApiError(rawMsg, {
      code,
      subcode,
      category: 'RATE_LIMIT',
      userMessage: 'Đã vượt quá giới hạn tần suất gọi Meta API (Rate Limit). Vui lòng thử lại sau vài phút.',
      technicalDetails: `Meta Rate Limit (code ${code}): ${rawMsg}`,
    });
  }

  return new MetaApiError(rawMsg, {
    code,
    subcode,
    category: 'API_ERROR',
    userMessage: `Lỗi kết nối Meta API: ${rawMsg}`,
    technicalDetails: `Meta API Error [${code}:${subcode}]: ${rawMsg}`,
  });
}

/**
 * MetaApiService integrates directly with the Meta Marketing API
 */
export class MetaApiService {
  public static mockRetryCounter: Record<string, number> = {};

  public static resetMockRetryCounter(): void {
    MetaApiService.mockRetryCounter = {};
  }

  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
    };
  }

  public static getDecryptedToken(connection: MetaConnectionParam): string {
    const rawToken = connection.accessToken || connection.encryptedAccessToken || '';
    if (rawToken && rawToken.includes(':')) {
      return decrypt(rawToken);
    }
    return rawToken;
  }

  /**
   * Helper to make requests to the Meta Graph API.
   * Handles dynamic API versioning and token assignment.
   */
  public static async requestMetaAPI<T = Record<string, unknown>>(
    endpoint: string,
    connection: MetaConnectionParam,
    params: Record<string, string> = {}
  ): Promise<T> {
    const version = connection.graphApiVersion || 'v25.0';
    const token = this.getDecryptedToken(connection);

    // Mock handler for demo tokens & automated test tokens
    if (
      token.startsWith('EAABwXyzFake') ||
      token === 'mock-token' ||
      token.startsWith('test-token-')
    ) {
      return this.handleMockRequest(endpoint, params, token) as T;
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
        throw parseMetaError(data);
      }

      return data as T;
    } catch (error: unknown) {
      if (error instanceof MetaApiError) {
        throw error;
      }
      const rawMsg = (error as Error)?.message || 'Unknown network error';
      throw new MetaApiError(`Connection timeout or network error: ${rawMsg}`, {
        category: 'NETWORK_ERROR',
        userMessage: 'Lỗi mạng khi gọi Meta Graph API. Vui lòng kiểm tra đường truyền và thử lại.',
        technicalDetails: rawMsg,
      });
    }
  }

  /**
   * Bounded exponential backoff retry for transient network and rate limit errors.
   */
  public static async requestMetaAPIWithRetry<T = Record<string, unknown>>(
    endpoint: string,
    connection: MetaConnectionParam,
    params: Record<string, string> = {},
    options: { maxRetries?: number; baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 200;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await this.requestMetaAPI<T>(endpoint, connection, params);
      } catch (error: unknown) {
        attempt++;
        if (error instanceof MetaApiError) {
          const isRetryable =
            error.category === 'RATE_LIMIT' ||
            error.category === 'NETWORK_ERROR' ||
            (error.code !== undefined && [17, 613, 80000, 2].includes(error.code));

          if (!isRetryable || attempt > maxRetries) {
            throw error;
          }
        } else if (attempt > maxRetries) {
          throw error;
        }

        // Jittered exponential backoff: 200ms, 400ms, 800ms...
        const jitter = Math.floor(Math.random() * 50);
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new MetaApiError('Max retries exceeded while calling Meta API', {
      category: 'NETWORK_ERROR',
      userMessage: 'Gọi Meta API vượt quá số lần thử lại tối đa.',
    });
  }

  /**
   * Cursor-based paginated Meta API fetcher.
   * Handles forward cursors and respects maxPages / limit constraints.
   */
  public static async fetchPaginatedMetaAPI<T>(
    endpoint: string,
    connection: MetaConnectionParam,
    params: Record<string, string> = {},
    options: MetaPaginationOptions = {}
  ): Promise<MetaPaginatedResult<T>> {
    const limit = Math.min(options.limit || 50, 100);
    const maxPages = Math.min(options.maxPages || 3, 10);
    let currentCursor = options.afterCursor;
    let pagesFetched = 0;
    const allData: T[] = [];
    let nextCursor: string | undefined = undefined;
    let hasMore = false;

    while (pagesFetched < maxPages) {
      const queryParams: Record<string, string> = {
        ...params,
        limit: limit.toString(),
      };
      if (currentCursor) {
        queryParams.after = currentCursor;
      }

      const response = await this.requestMetaAPIWithRetry<MetaPaginatedResponse<T>>(
        endpoint,
        connection,
        queryParams,
        options.retryOptions
      );

      const items = response.data || [];
      allData.push(...items);
      pagesFetched++;

      const cursorAfter = response.paging?.cursors?.after;
      const hasNextLink = !!response.paging?.next;

      if (cursorAfter && (hasNextLink || items.length === limit)) {
        currentCursor = cursorAfter;
        nextCursor = cursorAfter;
        hasMore = true;
      } else {
        hasMore = false;
        nextCursor = undefined;
        break;
      }
    }

    return {
      data: allData,
      pagesFetched,
      totalFetched: allData.length,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Mock request handler for demo tokens and automated testing
   */
  private static handleMockRequest(
    endpoint: string,
    params: Record<string, string>,
    token: string
  ): Record<string, unknown> {
    // Simulated error conditions for automated testing
    if (token === 'test-token-expired') {
      throw new MetaApiError('Error validating access token: Session has expired', {
        code: 190,
        subcode: 463,
        category: 'TOKEN_EXPIRED',
        userMessage: 'Access Token đã hết hạn hoặc không hợp lệ. Vui lòng tạo Token mới từ Meta for Developers và cập nhật lại cấu hình kết nối.',
      });
    }

    if (token === 'test-token-no-ads-read') {
      throw new MetaApiError('Requires ads_read permission', {
        code: 200,
        category: 'MISSING_ADS_READ',
        userMessage: 'Token thiếu quyền ads_read. Vui lòng cấp quyền ads_read cho token trong Meta for Developers hoặc Meta App để truy cập dữ liệu quảng cáo.',
      });
    }

    if (token === 'test-token-no-account' && endpoint.startsWith('act_')) {
      throw new MetaApiError(`Unsupported get request. Object with ID '${endpoint}' does not exist, cannot be loaded due to missing permissions`, {
        code: 100,
        category: 'ACCOUNT_NOT_ACCESSIBLE',
        userMessage: 'Không tìm thấy hoặc Token không có quyền truy cập Ad Account này. Vui lòng kiểm tra lại Ad Account ID (dạng act_xxxxxxxx) và phân quyền của bạn trong Trình quản lý quảng cáo.',
      });
    }

    if (token === 'test-token-missing-bm' && params.fields && params.fields.includes('business')) {
      throw new MetaApiError('(#100) Requires business_management permission to access the field.', {
        code: 100,
        category: 'MISSING_BUSINESS_MANAGEMENT',
        userMessage: 'Yêu cầu quyền business_management để đọc thông tin Business Manager. Với tính năng đọc và phân tích quảng cáo cơ bản, hệ thống chỉ cần quyền ads_read.',
      });
    }

    if (token === 'test-token-rate-limit') {
      const key = `${endpoint}_${params.limit || ''}`;
      const attempt = MetaApiService.mockRetryCounter[key] || 0;
      MetaApiService.mockRetryCounter[key] = attempt + 1;
      if (attempt === 0) {
        throw new MetaApiError('Meta API rate limit exceeded on attempt 1', {
          code: 17,
          category: 'RATE_LIMIT',
          userMessage: 'Đã vượt quá giới hạn tần suất gọi Meta API. Vui lòng thử lại sau vài phút.',
        });
      }
      return { id: 'recovered_after_retry', success: true };
    }

    if (token === 'test-token-pagination') {
      if (endpoint.endsWith('/campaigns')) {
        if (params.after === 'cursor_camp_p1') {
          return {
            data: [
              {
                id: 'c_mock_p2_1',
                name: 'LINHPT_DEWEYTHT_MESS_TS_021126_MATH',
                objective: 'OUTCOMES_MESSAGES',
                status: 'ACTIVE',
                effective_status: 'ACTIVE',
              },
            ],
            paging: {
              cursors: {
                before: 'cursor_camp_p1',
                after: 'cursor_camp_p2',
              },
            },
          };
        }
        return {
          data: [
            {
              id: 'c_mock_p1_1',
              name: 'NAMNV_DEWEYCG_LEADADS_TS_021126_TIENGANH',
              objective: 'OUTCOMES_LEADS',
              status: 'ACTIVE',
              effective_status: 'ACTIVE',
            },
          ],
          paging: {
            cursors: {
              after: 'cursor_camp_p1',
            },
            next: `https://graph.facebook.com/v25.0/${endpoint}?after=cursor_camp_p1`,
          },
        };
      }
    }

    if (token === 'test-token-relationships') {
      if (endpoint.endsWith('/campaigns')) {
        return {
          data: [
            { id: 'c_rel_1', name: 'NAMNV_DEWEYCG_LEADADS_TS_021126_TIENGANH', objective: 'OUTCOMES_LEADS', status: 'ACTIVE', effective_status: 'ACTIVE' },
            { id: 'c_rel_2', name: 'LINHPT_DEWEYTHT_MESS_TS_021126_MATH', objective: 'OUTCOMES_MESSAGES', status: 'ACTIVE', effective_status: 'ACTIVE' },
          ],
        };
      }

      if (endpoint.endsWith('/adsets')) {
        return {
          data: [
            { id: 'as_rel_1', campaign_id: 'c_rel_1', name: 'LOOKALIKE_3PCT | 2244 | ALL | RETARGETING', status: 'ACTIVE' },
            { id: 'as_rel_2', campaign_id: 'c_rel_2', name: 'BROAD | 2545 | FEMALE | PROSPECTING', status: 'ACTIVE' },
            { id: 'as_orphan', campaign_id: 'c_orphan_999', name: 'ORPHAN_AS | 3050 | ALL | PROSPECTING', status: 'ACTIVE' },
          ],
        };
      }

      if (endpoint.endsWith('/ads')) {
        return {
          data: [
            { id: 'ad_rel_1', campaign_id: 'c_rel_1', adset_id: 'as_rel_1', name: 'C46V46_Video Mastery_Chương trình Mastery', status: 'ACTIVE' },
            { id: 'ad_rel_2', campaign_id: 'c_rel_2', adset_id: 'as_rel_2', name: 'C41.2D41.2_Adventure KR_Tuyển sinh', status: 'ACTIVE' },
            { id: 'ad_orphan_adset', campaign_id: 'c_rel_1', adset_id: 'as_orphan_888', name: 'C43D43_TS chung HP_Tuyển sinh', status: 'ACTIVE' },
            { id: 'ad_orphan_camp', campaign_id: 'c_orphan_999', adset_id: 'as_rel_1', name: 'C44D44_HT Mastery Math_Chương trình Mastery', status: 'ACTIVE' },
          ],
        };
      }

      if (endpoint.includes('insights')) {
        if (params.level === 'campaign') {
          return {
            data: [
              { campaign_id: 'c_rel_1', campaign_name: 'NAMNV_DEWEYCG_LEADADS_TS_021126_TIENGANH', spend: '2500000', impressions: '50000', clicks: '1200', leads: '18', date_start: '2026-05-15', date_stop: '2026-05-22' },
              { campaign_id: 'c_rel_2', campaign_name: 'LINHPT_DEWEYTHT_MESS_TS_021126_MATH', spend: '1800000', impressions: '38000', clicks: '950', leads: '10', date_start: '2026-05-15', date_stop: '2026-05-22' },
            ],
          };
        }
        return {
          data: [
            { ad_id: 'ad_rel_1', ad_name: 'C46V46_Video Mastery_Chương trình Mastery', campaign_id: 'c_rel_1', adset_id: 'as_rel_1', spend: '1500000', impressions: '32000', clicks: '800', leads: '12', date_start: '2026-05-15', date_stop: '2026-05-22' },
            { ad_id: 'ad_rel_2', ad_name: 'C41.2D41.2_Adventure KR_Tuyển sinh', campaign_id: 'c_rel_2', adset_id: 'as_rel_2', spend: '1800000', impressions: '38000', clicks: '950', leads: '10', date_start: '2026-05-15', date_stop: '2026-05-22' },
          ],
        };
      }
    }

    if (endpoint === 'me') {
      return { id: 'demo_user_123', name: 'Dewey Demo Manager' };
    }

    if (endpoint === 'me/permissions') {
      return {
        data: [
          { permission: 'ads_read', status: 'granted' },
          { permission: 'public_profile', status: 'granted' },
        ],
      };
    }

    if (endpoint === 'me/adaccounts') {
      return {
        data: [
          {
            id: 'act_2938472948',
            account_id: '2938472948',
            name: 'Dewey School Global Campaigns',
            currency: 'VND',
            timezone_name: 'Asia/Ho_Chi_Minh',
            account_status: 1,
          },
        ],
      };
    }

    if (endpoint.startsWith('act_')) {
      if (params.fields && params.fields.includes('business')) {
        return {
          id: endpoint,
          business: { id: 'biz_8899', name: 'Dewey Education Group' },
        };
      }
      return {
        id: endpoint,
        account_id: endpoint.replace('act_', ''),
        name: `Dewey Account ${endpoint}`,
        currency: 'VND',
        timezone_name: 'Asia/Ho_Chi_Minh',
        account_status: 1,
      };
    }

    if (endpoint.includes('insights')) {
      return { data: [] };
    }

    return { data: [] };
  }

  /**
   * Validate standard connection credential
   */
  public static async validateAccessToken(connection: MetaConnectionParam): Promise<boolean> {
    try {
      const data = await this.requestMetaAPI<{ id?: string }>('me', connection, { fields: 'id,name' });
      return !!data.id;
    } catch (error) {
      console.error('Validation failed:', error);
      throw error;
    }
  }

  /**
   * Inspect token permissions and basic profile.
   * Checks for 'ads_read' and 'business_management'.
   */
  public static async getTokenPermissions(connection: MetaConnectionParam): Promise<{
    valid: boolean;
    userId?: string;
    userName?: string;
    permissions: string[];
    hasAdsRead: boolean;
    hasBusinessManagement: boolean;
  }> {
    const me = await this.requestMetaAPI<{ id?: string; name?: string }>('me', connection, { fields: 'id,name' });
    let permissions: string[] = [];

    try {
      const permsRes = await this.requestMetaAPI<{ data?: Array<{ permission: string; status?: string }> }>('me/permissions', connection);
      if (Array.isArray(permsRes?.data)) {
        permissions = permsRes.data
          .filter((p: { status?: string; permission?: string }) => p.status === 'granted')
          .map((p: { permission: string }) => p.permission);
      }
    } catch (e: unknown) {
      console.warn('Could not read me/permissions:', (e as Error).message);
    }

    // Default to true if permissions list couldn't be read but user profile succeeded
    const hasAdsRead = permissions.length === 0 ? true : permissions.includes('ads_read');
    const hasBusinessManagement = permissions.includes('business_management');

    return {
      valid: !!me.id,
      userId: me.id,
      userName: me.name,
      permissions,
      hasAdsRead,
      hasBusinessManagement,
    };
  }

  /**
   * Fetch list of Ad Accounts connected to the credentials.
   * Uses ONLY 'ads_read' permission.
   * Explicitly avoids requesting 'business' field so tokens without
   * 'business_management' permission will NEVER fail with (#100).
   */
  public static async getAdAccounts(connection: MetaConnectionParam): Promise<MetaAccountInfo[]> {
    const data = await this.requestMetaAPI<{ data?: MetaRawAccount[] }>('me/adaccounts', connection, {
      fields: 'id,account_id,name,currency,timezone_name,account_status',
      limit: '50',
    });

    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data.map((acc: MetaRawAccount) => ({
      accountId: acc.id || (acc.account_id ? `act_${acc.account_id}` : ''),
      accountName: acc.name || `Ad Account ${acc.account_id || acc.id}`,
      currency: acc.currency || 'VND',
      timezoneName: acc.timezone_name || 'Asia/Ho_Chi_Minh',
      businessId: undefined, // Basic account discovery uses ads_read only
      status: acc.account_status === 1 ? 'ACTIVE' : 'DISABLED',
    }));
  }

  /**
   * Fetch a single Ad Account directly by its ID.
   * Useful when user manually inputs Ad Account ID or when me/adaccounts is restricted.
   * Uses ONLY 'ads_read' permission.
   */
  public static async getAdAccount(
    adAccountId: string,
    connection: MetaConnectionParam
  ): Promise<MetaAccountInfo> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    const data = await this.requestMetaAPI<MetaRawAccount>(normalizedId, connection, {
      fields: 'id,account_id,name,currency,timezone_name,account_status',
    });

    return {
      accountId: data.id || normalizedId,
      accountName: data.name || `Ad Account ${normalizedId}`,
      currency: data.currency || 'VND',
      timezoneName: data.timezone_name || 'Asia/Ho_Chi_Minh',
      businessId: undefined,
      status: data.account_status === 1 ? 'ACTIVE' : 'DISABLED',
    };
  }

  /**
   * Optional: Fetch Business Manager details for an Ad Account.
   * Requires 'business_management' permission.
   * Completely isolated so failure never blocks account sync.
   */
  public static async getBusinessInfo(
    adAccountId: string,
    connection: MetaConnectionParam
  ): Promise<{ businessId?: string; businessName?: string } | null> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    try {
      const data = await this.requestMetaAPI<{ business?: { id?: string; name?: string } }>(normalizedId, connection, {
        fields: 'business{id,name}',
      });

      if (data && data.business) {
        return {
          businessId: data.business.id,
          businessName: data.business.name,
        };
      }
      return null;
    } catch (err: unknown) {
      // Gracefully catch missing business_management or non-BM ad account
      console.warn(`Optional Business Manager fetch skipped for ${normalizedId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Fetch list of Campaigns in an Account
   */
  public static async getCampaigns(adAccountId: string, connection: MetaConnectionParam): Promise<MetaCampaignRecord[]> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    let results: MetaCampaignRecord[] = [];
    const endpoint = `${normalizedId}/campaigns`;
    const params: Record<string, string> = {
      fields: 'id,name,objective,buying_type,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
      limit: '100',
    };

    const response = await this.requestMetaAPI<{ data?: MetaCampaignRecord[] }>(endpoint, connection, params);
    if (response.data) results = response.data;
    
    return results;
  }

  /**
   * Fetch list of Ad Sets in an Account
   */
  public static async getAdSets(adAccountId: string, connection: MetaConnectionParam): Promise<MetaAdSetRecord[]> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    let results: MetaAdSetRecord[] = [];
    const response = await this.requestMetaAPI<{ data?: MetaAdSetRecord[] }>(`${normalizedId}/adsets`, connection, {
      fields: 'id,campaign_id,name,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,targeting,status,effective_status,start_time,end_time',
      limit: '100',
    });
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Fetch list of Ads in an Account
   */
  public static async getAds(adAccountId: string, connection: MetaConnectionParam): Promise<MetaAdRecord[]> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    let results: MetaAdRecord[] = [];
    const response = await this.requestMetaAPI<{ data?: MetaAdRecord[] }>(`${normalizedId}/ads`, connection, {
      fields: 'id,campaign_id,adset_id,name,creative,status,effective_status,created_time,updated_time',
      limit: '100',
    });
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Fetch list of Creatives in an Account
   */
  public static async getCreatives(adAccountId: string, connection: MetaConnectionParam): Promise<MetaCreativeRecord[]> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    let results: MetaCreativeRecord[] = [];
    const response = await this.requestMetaAPI<{ data?: MetaCreativeRecord[] }>(`${normalizedId}/adcreatives`, connection, {
      fields: 'id,name,title,body,image_url,thumbnail_url,video_id,object_story_id,call_to_action_type,object_url',
      limit: '100',
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
  ): Promise<MetaInsightRecord[]> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    let results: MetaInsightRecord[] = [];
    const response = await this.requestMetaAPI<{ data?: MetaInsightRecord[] }>(`${normalizedId}/insights`, connection, {
      level,
      time_increment: '1',
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      fields: 'date_start,date_stop,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type,video_3sec_video_view,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions',
      limit: '100',
    });
    
    if (response.data) results = response.data;
    return results;
  }

  /**
   * Fetch list of Campaigns with cursor-based pagination
   */
  public static async getCampaignsPaged(
    adAccountId: string,
    connection: MetaConnectionParam,
    options?: MetaPaginationOptions
  ): Promise<MetaPaginatedResult<MetaCampaignRecord>> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    const endpoint = `${normalizedId}/campaigns`;
    const params: Record<string, string> = {
      fields: 'id,name,objective,buying_type,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
    };

    return this.fetchPaginatedMetaAPI<MetaCampaignRecord>(endpoint, connection, params, options);
  }

  /**
   * Fetch list of Ad Sets with cursor-based pagination
   */
  public static async getAdSetsPaged(
    adAccountId: string,
    connection: MetaConnectionParam,
    options?: MetaPaginationOptions
  ): Promise<MetaPaginatedResult<MetaAdSetRecord>> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    const endpoint = `${normalizedId}/adsets`;
    const params: Record<string, string> = {
      fields: 'id,campaign_id,name,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,targeting,status,effective_status,start_time,end_time',
    };

    return this.fetchPaginatedMetaAPI<MetaAdSetRecord>(endpoint, connection, params, options);
  }

  /**
   * Fetch list of Ads with cursor-based pagination
   */
  public static async getAdsPaged(
    adAccountId: string,
    connection: MetaConnectionParam,
    options?: MetaPaginationOptions
  ): Promise<MetaPaginatedResult<MetaAdRecord>> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    const endpoint = `${normalizedId}/ads`;
    const params: Record<string, string> = {
      fields: 'id,campaign_id,adset_id,name,creative,status,effective_status,created_time,updated_time',
    };

    return this.fetchPaginatedMetaAPI<MetaAdRecord>(endpoint, connection, params, options);
  }

  /**
   * Fetch Insights with cursor-based pagination
   */
  public static async getInsightsPaged(
    adAccountId: string,
    connection: MetaConnectionParam,
    level: 'campaign' | 'adset' | 'ad',
    dateFrom: string,
    dateTo: string,
    options?: MetaPaginationOptions
  ): Promise<MetaPaginatedResult<MetaInsightRecord>> {
    const normalizedId = normalizeAdAccountId(adAccountId);
    const endpoint = `${normalizedId}/insights`;
    const params: Record<string, string> = {
      level,
      time_increment: '1',
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      fields: 'date_start,date_stop,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type,video_3sec_video_view,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions',
    };

    return this.fetchPaginatedMetaAPI<MetaInsightRecord>(endpoint, connection, params, options);
  }
}
